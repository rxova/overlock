#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { GitError, repoRoot } from './git.js';
import { parseStopPayload, stopHookOutcome } from './hook.js';
import { AGENTS, type Agent, initClaude, initInstructions, instructionSnippet } from './init.js';
import { compact, human, json, useColor } from './report.js';
import { run } from './run.js';
import type { Severity } from './types.js';

const VERSION = typeof __PATCHFINDER_VERSION__ === 'string' ? __PATCHFINDER_VERSION__ : '0.0.0';

const USAGE = `patchfinder ${VERSION} — find out what your coding agent did to your tests.

USAGE
  patchfinder [check] [options]     Check the current patch (default command)
  patchfinder hook claude           Run as a Claude Code Stop hook (reads stdin)
  patchfinder init <agent>          Wire it into an agent: ${AGENTS.join(', ')}

CHECK OPTIONS
  --base <ref>       Diff against this ref. Default: auto
                     (auto = uncommitted work if any, else this branch's commits)
  --staged           Check only what is staged
  --json             Machine-readable report on stdout
  --compact          The short form a phone can read
  --fail-on <level>  high | medium | low | none. Default: high
  --limit <n>        Findings shown in --compact. Default: 3
  --test-glob <re>   Extra regex marking a path as a test file (repeatable)
  --cwd <dir>        Run against this directory
  --no-ledger        Do not record this run in ~/.patchfinder/ledger.jsonl

EXIT CODES
  0  nothing at or above --fail-on
  1  findings at or above --fail-on
  2  patchfinder could not run

Findings are advisory. The tool reads a diff; it never edits your code, and it
makes no network calls.`;

export interface ParsedArgs {
  command: 'check' | 'hook' | 'init' | 'help' | 'version';
  target?: string;
  base?: string;
  staged: boolean;
  format: 'human' | 'json' | 'compact';
  failOn: Severity | 'none';
  limit: number;
  testGlobs: RegExp[];
  cwd: string;
  ledger: boolean;
}

export class UsageError extends Error {}

export function parseArgs(argv: string[], cwd = process.cwd()): ParsedArgs {
  const parsed: ParsedArgs = {
    command: 'check',
    staged: false,
    format: 'human',
    failOn: 'high',
    limit: 3,
    testGlobs: [],
    cwd,
    ledger: true,
  };

  const rest = [...argv];
  const first = rest[0];

  if (first !== undefined && !first.startsWith('-')) {
    if (first !== 'check' && first !== 'hook' && first !== 'init') {
      throw new UsageError(`Unknown command: ${first}`);
    }
    parsed.command = first;
    rest.shift();
    const target = rest[0];
    if (target !== undefined && !target.startsWith('-')) {
      parsed.target = target;
      rest.shift();
    }
  }

  const value = (flag: string): string => {
    const next = rest.shift();
    if (next === undefined) throw new UsageError(`${flag} needs a value`);
    return next;
  };

  while (rest.length > 0) {
    const arg = rest.shift() as string;

    switch (arg) {
      case '-h':
      case '--help':
        parsed.command = 'help';
        break;
      case '-v':
      case '--version':
        parsed.command = 'version';
        break;
      case '--json':
        parsed.format = 'json';
        break;
      case '--compact':
        parsed.format = 'compact';
        break;
      case '--staged':
        parsed.staged = true;
        break;
      case '--no-ledger':
        parsed.ledger = false;
        break;
      case '--base':
        parsed.base = value('--base');
        break;
      case '--cwd':
        parsed.cwd = value('--cwd');
        break;
      case '--limit': {
        const limit = Number(value('--limit'));
        if (!Number.isInteger(limit) || limit < 1) {
          throw new UsageError('--limit needs a positive integer');
        }
        parsed.limit = limit;
        break;
      }
      case '--fail-on': {
        const level = value('--fail-on');
        if (level !== 'high' && level !== 'medium' && level !== 'low' && level !== 'none') {
          throw new UsageError('--fail-on must be high, medium, low or none');
        }
        parsed.failOn = level;
        break;
      }
      case '--test-glob': {
        const pattern = value('--test-glob');
        try {
          parsed.testGlobs.push(new RegExp(pattern));
        } catch (error) {
          throw new UsageError(`--test-glob is not a valid regex: ${pattern}`, { cause: error });
        }
        break;
      }
      default:
        throw new UsageError(`Unknown option: ${arg}`);
    }
  }

  return parsed;
}

export interface Io {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  readStdin: () => string;
  isTTY: boolean;
  env: NodeJS.ProcessEnv;
}

export function main(argv: string[], io: Io): number {
  let args: ParsedArgs;
  try {
    args = parseArgs(argv);
  } catch (error) {
    io.stderr(`${error instanceof Error ? error.message : String(error)}\n\n${USAGE}\n`);
    return 2;
  }

  if (args.command === 'help') {
    io.stdout(`${USAGE}\n`);
    return 0;
  }
  if (args.command === 'version') {
    io.stdout(`${VERSION}\n`);
    return 0;
  }

  try {
    if (args.command === 'init') return runInit(args, io);

    const { report } = run({
      cwd: args.cwd,
      // The hook has no human to pass a ref, so it always resolves the range
      // itself. `check` without --base looks at the working tree, which is what
      // someone typing it at a prompt means.
      base: args.command === 'hook' ? (args.base ?? 'auto') : args.base,
      staged: args.staged,
      failOn: args.failOn,
      testGlobs: args.testGlobs,
      mode: args.command === 'hook' ? 'hook' : 'check',
      ledger: args.ledger,
    });

    if (args.command === 'hook') {
      const outcome = stopHookOutcome(report, parseStopPayload(io.readStdin()));
      if (outcome.stdout) io.stdout(outcome.stdout);
      if (outcome.stderr) io.stderr(outcome.stderr);
      return outcome.exitCode;
    }

    if (args.format === 'json') io.stdout(`${json(report)}\n`);
    else if (args.format === 'compact') io.stdout(`${compact(report, args.limit)}\n`);
    else io.stdout(`${human(report, useColor({ isTTY: io.isTTY }, io.env))}\n`);

    return report.ok ? 0 : 1;
  } catch (error) {
    if (error instanceof GitError) {
      io.stderr(`patchfinder: ${error.message}. Is this a git repository?\n`);
      return 2;
    }
    io.stderr(`patchfinder: ${error instanceof Error ? error.message : String(error)}\n`);
    return 2;
  }
}

function runInit(args: ParsedArgs, io: Io): number {
  const agent = args.target as Agent | undefined;
  if (agent === undefined || !AGENTS.includes(agent)) {
    io.stderr(`patchfinder init needs one of: ${AGENTS.join(', ')}\n`);
    return 2;
  }

  const root = repoRoot(args.cwd);
  const result = agent === 'claude' ? initClaude(root) : initInstructions(root, agent);

  for (const file of result.written) io.stdout(`wrote ${file}\n`);
  for (const note of result.notes) io.stdout(`  ${note}\n`);

  if (agent === 'claude' && !result.unchanged) {
    io.stdout('\nThe hook runs on every Stop and blocks only on HIGH findings.\n');
    io.stdout('Try it: weaken a test on purpose, then ask your agent to finish.\n');
  }
  if (agent !== 'claude') io.stdout(`\n${instructionSnippet()}`);

  return 0;
}

/* c8 ignore start -- process wiring; the e2e suite drives the real binary */
if (process.env.PATCHFINDER_NO_AUTORUN !== '1') {
  process.exitCode = main(process.argv.slice(2), {
    stdout: (text) => process.stdout.write(text),
    stderr: (text) => process.stderr.write(text),
    readStdin: () => {
      try {
        // fd 0 as a file read: a hook is always given its payload on a pipe, and
        // when it is not (someone ran `patchfinder hook claude` by hand at a
        // terminal) this throws rather than hanging forever waiting for EOF.
        return readFileSync(0, 'utf8');
      } catch {
        return '';
      }
    },
    isTTY: process.stdout.isTTY === true,
    env: process.env,
  });
}
/* c8 ignore stop */
