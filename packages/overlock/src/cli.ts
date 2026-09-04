#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { GitError, repoRoot } from './git.js';
import { parseStopPayload, stopHookOutcome } from './hook.js';
import {
  AGENTS,
  type Agent,
  initClaude,
  initInstructions,
  instructionSnippet,
  mcpSnippet,
} from './init.js';
import { compact, human, json, summaryText, useColor } from './report.js';
import { run } from './run.js';
import { ledgerPath } from './ledger.js';
import { readLedger, summarize } from './summary.js';
import { MessageBuffer, handleMessage } from './mcp.js';
import { RULE_IDS, type RuleId, type Severity } from './types.js';

const VERSION = typeof __OVERLOCK_VERSION__ === 'string' ? __OVERLOCK_VERSION__ : '0.0.0';

const USAGE = `overlock ${VERSION} — find out what your coding agent did to your tests.

USAGE
  overlock [check] [options]     Check the current patch (default command)
  overlock hook claude           Run as a Claude Code Stop hook (reads stdin)
  overlock init <agent>          Wire it into an agent: ${AGENTS.join(', ')}
  overlock report [--days N]     What the ledger has been recording
  overlock mcp                   Serve as an MCP tool over stdio

CHECK OPTIONS
  --base <ref>       Diff against this ref. Default: auto
                     (auto = uncommitted work if any, else this branch's commits)
  --staged           Check only what is staged
  --json             Machine-readable report on stdout
  --compact          The short form a phone can read
  --fail-on <level>  high | medium | low | none. Default: high
  --severity <r>=<l> Grade one rule differently, e.g. TEST_REMOVED=medium
                     (repeatable; a rule graded low never blocks)
  --limit <n>        Findings shown in --compact. Default: 3
  --test-glob <re>   Extra regex marking a path as a test file (repeatable)
  --cwd <dir>        Run against this directory
  --no-untracked     Skip files git does not track yet (they are included by default)
  --no-ledger        Do not record this run in ~/.overlock/ledger.jsonl

SILENCING A FINDING
  Put a comment on the offending line, or the line above it:

    // overlock-ignore TEST_SKIPPED_ADDED -- quarantined pending #412

  A finding with no line of its own — a deleted test file has none — is named
  by its path instead, from any line the patch still has:

    // overlock-ignore TEST_REMOVED src/api.test.ts -- module deleted; cases
    // re-homed in store.test.ts

  The rule ID and the reason are both required. A directive without a written
  reason silences nothing.

REPORT OPTIONS
  --days <n>         Only count runs from the last n days. Default: 30
  --json             The aggregate as data

EXIT CODES
  0  nothing at or above --fail-on
  1  findings at or above --fail-on
  2  overlock could not run

Findings are advisory. The tool reads a diff; it never edits your code, and it
makes no network calls.`;

export interface ParsedArgs {
  command: 'check' | 'hook' | 'init' | 'report' | 'mcp' | 'help' | 'version';
  target?: string;
  base?: string;
  staged: boolean;
  format: 'human' | 'json' | 'compact';
  failOn: Severity | 'none';
  limit: number;
  days: number;
  testGlobs: RegExp[];
  severities: Partial<Record<RuleId, Severity>>;
  cwd: string;
  ledger: boolean;
  untracked: boolean;
}

export class UsageError extends Error {}

export function parseArgs(argv: string[], cwd = process.cwd()): ParsedArgs {
  const parsed: ParsedArgs = {
    command: 'check',
    staged: false,
    format: 'human',
    failOn: 'high',
    limit: 3,
    days: 30,
    testGlobs: [],
    severities: {},
    cwd,
    ledger: true,
    untracked: true,
  };

  const rest = [...argv];
  const first = rest[0];

  if (first !== undefined && !first.startsWith('-')) {
    const commands = ['check', 'hook', 'init', 'report', 'mcp'] as const;
    if (!(commands as readonly string[]).includes(first)) {
      throw new UsageError(`Unknown command: ${first}`);
    }
    parsed.command = first as ParsedArgs['command'];
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
      case '--no-untracked':
        parsed.untracked = false;
        break;
      case '--base':
        parsed.base = value('--base');
        break;
      case '--cwd':
        parsed.cwd = value('--cwd');
        break;
      case '--days': {
        const days = Number(value('--days'));
        if (!Number.isInteger(days) || days < 1) {
          throw new UsageError('--days needs a positive integer');
        }
        parsed.days = days;
        break;
      }
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
      case '--severity': {
        // `RULE=level`, and both halves are checked against the frozen lists.
        // A typo that silently did nothing would be the worst possible
        // behaviour here: the person would believe a rule was graded down and
        // find out otherwise from a blocked merge.
        const spec = value('--severity');
        const [rule, level] = spec.split('=');
        if (!rule || !(RULE_IDS as readonly string[]).includes(rule)) {
          throw new UsageError(`--severity needs a known rule: ${spec}`);
        }
        if (level !== 'high' && level !== 'medium' && level !== 'low') {
          throw new UsageError(`--severity level must be high, medium or low: ${spec}`);
        }
        parsed.severities[rule as RuleId] = level;
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
  /** Streaming stdin, for the long-lived MCP transport. */
  onStdin: (handler: (chunk: string) => void) => void;
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
    if (args.command === 'report') return runReport(args, io);
    if (args.command === 'mcp') return runMcp(args, io);

    const { report } = run({
      cwd: args.cwd,
      // The hook has no human to pass a ref, so it always resolves the range
      // itself. `check` without --base looks at the working tree, which is what
      // someone typing it at a prompt means.
      base: args.command === 'hook' ? (args.base ?? 'auto') : args.base,
      staged: args.staged,
      failOn: args.failOn,
      severities: args.severities,
      testGlobs: args.testGlobs,
      mode: args.command === 'hook' ? 'hook' : 'check',
      ledger: args.ledger,
      untracked: args.untracked,
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
      io.stderr(`overlock: ${error.message}${error.hint ? `. ${error.hint}` : ''}\n`);
      return 2;
    }
    io.stderr(`overlock: ${error instanceof Error ? error.message : String(error)}\n`);
    return 2;
  }
}

/**
 * Reading the ledger back. Always exits 0: this reports history, it does not
 * gate anything, and a shell that treated a month with findings as a failure
 * would be answering a different question.
 */
function runReport(args: ParsedArgs, io: Io): number {
  const entries = readLedger(ledgerPath(io.env));
  const summary = summarize(entries, { days: args.days });

  if (args.format === 'json') io.stdout(`${JSON.stringify(summary, null, 2)}\n`);
  else io.stdout(`${summaryText(summary, useColor({ isTTY: io.isTTY }, io.env))}\n`);

  return 0;
}

/**
 * The MCP transport is stdout, so nothing else may be written to it — a stray
 * log line is a parse error at the other end. Everything human goes to stderr.
 */
function runMcp(args: ParsedArgs, io: Io): number {
  const deps = {
    version: VERSION,
    check: (call: { base?: string; staged?: boolean; failOn?: string }) =>
      run({
        cwd: args.cwd,
        base: call.base ?? 'auto',
        ...(call.staged === undefined ? {} : { staged: call.staged }),
        failOn: (call.failOn ?? 'high') as Severity | 'none',
        severities: args.severities,
        testGlobs: args.testGlobs,
        mode: 'check' as const,
        ledger: args.ledger,
        untracked: args.untracked,
      }).report,
    report: (call: { days?: number }) =>
      summarize(readLedger(ledgerPath(io.env)), { days: call.days ?? args.days }),
  };

  const buffer = new MessageBuffer();
  io.stderr(`overlock ${VERSION} mcp server ready\n`);

  io.onStdin((chunk) => {
    for (const message of buffer.push(chunk)) {
      const response = handleMessage(message, deps);
      if (response) io.stdout(`${JSON.stringify(response)}\n`);
    }
  });

  return 0;
}

function runInit(args: ParsedArgs, io: Io): number {
  const agent = args.target as Agent | undefined;
  if (agent === undefined || !AGENTS.includes(agent)) {
    io.stderr(`overlock init needs one of: ${AGENTS.join(', ')}\n`);
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

  io.stdout(`\nTo let agents discover it as a tool, add to .mcp.json:\n\n${mcpSnippet()}`);

  return 0;
}

/* c8 ignore start -- process wiring; the e2e suite drives the real binary */
if (process.env.OVERLOCK_NO_AUTORUN !== '1') {
  process.exitCode = main(process.argv.slice(2), {
    stdout: (text) => process.stdout.write(text),
    stderr: (text) => process.stderr.write(text),
    readStdin: () => {
      try {
        // fd 0 as a file read: a hook is always given its payload on a pipe, and
        // when it is not (someone ran `overlock hook claude` by hand at a
        // terminal) this throws rather than hanging forever waiting for EOF.
        return readFileSync(0, 'utf8');
      } catch {
        return '';
      }
    },
    onStdin: (handler) => {
      process.stdin.setEncoding('utf8');
      process.stdin.on('data', handler);
      // The server lives as long as its transport. When the client closes the
      // pipe there is nothing left to answer, so exiting is the correct end.
      process.stdin.on('end', () => process.exit(0));
      process.stdin.resume();
    },
    isTTY: process.stdout.isTTY === true,
    env: process.env,
  });
}
/* c8 ignore stop */
