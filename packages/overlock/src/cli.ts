#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  evaluationSummary,
  evaluationMarkdown,
  readEvaluation,
  replay,
  importEvaluation,
} from './evaluation.js';
import type { EvaluationConfig } from './evaluation-record.js';
import { CONFIG_FILE, loadConfig, type OverlockConfig } from './config.js';
import { type BaseMode, GitError, repoRoot } from './git.js';
import { parseStopPayload, sessionBase } from './hook.js';
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
import { RULE_IDS, type Grade, type RuleId, type Severity } from './types.js';

const VERSION = typeof __OVERLOCK_VERSION__ === 'string' ? __OVERLOCK_VERSION__ : '0.0.0';

const USAGE = `overlock ${VERSION} — report test-integrity findings in a git patch.

USAGE
  overlock [check] [options]     Check the current patch (default command)
  overlock hook claude           Run as a Claude Code Stop hook (reads stdin)
  overlock init <agent>          Wire it into an agent: ${AGENTS.join(', ')}
  overlock report [--days N]     What the ledger has been recording
  overlock evaluate [dir]        Summarize .overlock runs and human reviews
  overlock replay <manifest>     Replay labeled diffs; exit 1 on mismatches
  overlock import <file-or-dir>  Import CI/container JSONL artifacts
  overlock mcp                   Serve as an MCP tool over stdio
  overlock config                Show the settings in force, and where from

CHECK OPTIONS
  --base <ref>       Diff against where this branch left <ref>. Default: auto
                     (auto = uncommitted work if any, else this branch's commits)
  --base-mode <how>  fork-point | direct. Default: fork-point
                     (direct compares against the ref itself, so anything the
                      ref gained since this branch left it reads as a deletion)
  --explain-base     Say how the base was chosen, then run
  --fail-on-empty    Exit 1 when the resolved patch turns out to be empty
  --staged           Check only what is staged
  --json             Machine-readable report on stdout
  --compact          The short form, for small screens and hook output
  --fail-on <level>  high | medium | low | none. Default: high
  --severity <r>=<l> Grade one rule differently, e.g. TEST_REMOVED=medium
                     high | medium | low | off. Repeatable. A rule graded low
                     never blocks; one graded off reports nothing, and what it
                     silenced is counted in the verdict line
  --limit <n>        Findings shown in --compact. Default: 3
  --test-glob <re>   Extra regex marking a path as a test file (repeatable)
  --cwd <dir>        Run against this directory
  --allow-file <f>   Also read Overlock-Allow trailers from this file
  --no-untracked     Skip files git does not track yet (they are included by default)
  --no-ledger        Do not record in the legacy home ledger
  --no-evaluation    Do not write repository evaluation records
  --build <hash>     Evaluate one recorded build (evaluate only)
  --config <file>    Read settings from this file instead of searching
  --no-config        Ignore ${CONFIG_FILE} entirely

REPOSITORY SETTINGS
  ${CONFIG_FILE} beside your package.json — or an "overlock" key
  inside it — is read by the CLI, the Stop hook and the GitHub action alike, so
  one repository has one answer instead of three:

    { "base": "origin/main", "failOn": "high",
      "severity": { "TEST_REMOVED": "medium" },
      "testGlob": ["\\.check\\.ts$"], "exclude": [".basting"] }

  A flag always wins over the file. "overlock config" prints what is in force.

ACKNOWLEDGING A WHOLE PATCH
  A rename touching six hundred files cannot be answered with six hundred
  comments. Put a trailer in the commit message or the pull request body:

    Overlock-Allow: TEST_AND_IMPL_TOGETHER -- rename, no behaviour changed

  It needs a written reason like everything else here. At Stop time it applies
  to whatever the agent committed during the session; work still sitting in the
  tree has no commit message to read, so a trailer cannot cover it.

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
  --days <n>         Legacy report window in days. Default: 30
  --json             The aggregate as data

EXIT CODES
  0  nothing at or above --fail-on
  1  findings at or above --fail-on
  2  overlock could not run

Findings are advisory. The tool reads a diff; it never edits your code, and it
makes no network calls.`;

export interface ParsedArgs {
  command:
    | 'check'
    | 'hook'
    | 'init'
    | 'report'
    | 'mcp'
    | 'config'
    | 'evaluate'
    | 'replay'
    | 'import'
    | 'help'
    | 'version';
  target?: string;
  base?: string;
  baseMode: BaseMode;
  explainBase: boolean;
  failOnEmpty: boolean;
  staged: boolean;
  format: 'human' | 'json' | 'compact';
  failOn: Severity | 'none';
  limit: number;
  days: number;
  testGlobs: RegExp[];
  severities: Partial<Record<RuleId, Grade>>;
  allowFile?: string;
  cwd: string;
  ledger: boolean;
  evaluation?: EvaluationConfig;
  noEvaluation?: boolean;
  build?: string;
  untracked: boolean;
  /** Config-only: paths left out of the patch besides `.overlock`. */
  exclude: string[];
  configPath?: string;
  config: boolean;
  /** Flags the caller actually passed, so the file never overrides them. */
  explicit: Set<string>;
}

export class UsageError extends Error {}

export function parseArgs(argv: string[], cwd = process.cwd()): ParsedArgs {
  const parsed: ParsedArgs = {
    command: 'check',
    baseMode: 'fork-point',
    explainBase: false,
    failOnEmpty: false,
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
    exclude: [],
    config: true,
    explicit: new Set<string>(),
  };

  const rest = [...argv];
  const first = rest[0];

  if (first !== undefined && !first.startsWith('-')) {
    const commands = [
      'check',
      'hook',
      'init',
      'report',
      'mcp',
      'config',
      'evaluate',
      'replay',
      'import',
    ] as const;
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
    parsed.explicit.add(arg);

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
      case '--no-evaluation':
        parsed.noEvaluation = true;
        break;
      case '--build':
        parsed.build = value('--build');
        break;
      case '--no-ledger':
        parsed.ledger = false;
        break;
      case '--no-config':
        parsed.config = false;
        break;
      case '--config':
        parsed.configPath = value('--config');
        break;
      case '--no-untracked':
        parsed.untracked = false;
        break;
      case '--base':
        parsed.base = value('--base');
        break;
      case '--base-mode': {
        const mode = value('--base-mode');
        if (mode !== 'fork-point' && mode !== 'direct') {
          throw new UsageError('--base-mode must be fork-point or direct');
        }
        parsed.baseMode = mode;
        break;
      }
      case '--explain-base':
        parsed.explainBase = true;
        break;
      case '--fail-on-empty':
        parsed.failOnEmpty = true;
        break;
      case '--cwd':
        parsed.cwd = value('--cwd');
        break;
      case '--allow-file':
        parsed.allowFile = value('--allow-file');
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
        if (level !== 'high' && level !== 'medium' && level !== 'low' && level !== 'off') {
          throw new UsageError(`--severity level must be high, medium, low or off: ${spec}`);
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

/**
 * Fills in what the caller did not say. A flag that was passed is left alone,
 * including a `--no-` flag, which is a decision like any other.
 */
export function applyConfig(args: ParsedArgs, config: OverlockConfig): ParsedArgs {
  const said = (...flags: string[]): boolean => flags.some((f) => args.explicit.has(f));

  if (config.base !== undefined && !said('--base')) args.base = config.base;
  if (config.baseMode !== undefined && !said('--base-mode')) args.baseMode = config.baseMode;
  if (config.failOn !== undefined && !said('--fail-on')) args.failOn = config.failOn;
  if (config.failOnEmpty !== undefined && !said('--fail-on-empty')) {
    args.failOnEmpty = config.failOnEmpty;
  }
  if (config.untracked !== undefined && !said('--no-untracked')) args.untracked = config.untracked;
  if (config.exclude !== undefined) args.exclude = [...config.exclude];

  // The repeatable options are all-or-nothing rather than merged: a caller
  // passing one --severity means that list, and quietly adding the file's
  // entries to it would produce a policy nobody wrote down anywhere.
  if (config.severity !== undefined && !said('--severity')) {
    args.severities = { ...config.severity };
  }
  if (config.testGlob !== undefined && !said('--test-glob')) {
    args.testGlobs = config.testGlob.map((pattern) => new RegExp(pattern));
  }

  if (config.evaluation && !args.noEvaluation) args.evaluation = config.evaluation;
  return args;
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

  let settings: OverlockConfig = {};
  let settingsPath: string | null = null;
  try {
    if (args.config) {
      const loaded = loadConfig({ cwd: args.cwd, path: args.configPath });
      settings = loaded.config;
      settingsPath = loaded.path;
      applyConfig(args, settings);
    }
  } catch (error) {
    // A declared policy that cannot be read is not a policy. Failing here is
    // the whole point: silently running with the built-in defaults is how the
    // three surfaces drifted apart in the first place.
    io.stderr(`overlock: ${error instanceof Error ? error.message : String(error)}\n`);
    return 2;
  }

  try {
    if (args.command === 'evaluate') {
      const directory = args.target
        ? resolve(args.cwd, args.target)
        : join(repoRoot(args.cwd), '.overlock');
      const data = readEvaluation(directory);
      const runs = args.build ? data.runs.filter((r) => r.build === args.build) : data.runs;
      if (args.build && runs.length === 0)
        throw new UsageError(`No evaluation records for build ${args.build}`);
      const keys = new Set(runs.flatMap((r) => r.findings.map((f) => f.key)));
      const reviews = args.build ? data.reviews.filter((r) => keys.has(r.finding)) : data.reviews;
      const summary = evaluationSummary(runs, reviews);
      io.stdout(
        args.format === 'json'
          ? JSON.stringify(summary, null, 2) + '\n'
          : evaluationMarkdown(summary),
      );
      return 0;
    }
    if (args.command === 'replay') {
      if (!args.target) throw new UsageError('replay needs a manifest path');
      const result = replay(resolve(args.cwd, args.target));
      io.stdout(JSON.stringify(result, null, 2) + '\n');
      return result.matched === result.scored && result.blocking_matched === result.blocking_scored
        ? 0
        : 1;
    }
    if (args.command === 'import') {
      if (!args.target) throw new UsageError('import needs an artifact file or directory');
      const count = importEvaluation(
        resolve(args.cwd, args.target),
        join(repoRoot(args.cwd), '.overlock'),
      );
      io.stdout(`overlock: imported ${count} evaluation records.\n`);
      return 0;
    }
    if (args.command === 'config') return runConfig(args, settings, settingsPath, io);
    if (args.command === 'init') return runInit(args, io);
    if (args.command === 'report') return runReport(args, io);
    if (args.command === 'mcp') return runMcp(args, io);

    // Read before the run, not after it: the payload names the transcript, and
    // the transcript is what dates the session the base is measured from.
    const payload = args.command === 'hook' ? parseStopPayload(io.readStdin()) : {};
    const session =
      args.command === 'hook' && args.base === undefined ? sessionBase(payload, args.cwd) : null;

    const { report, steps, outcome, exitCode } = run({
      cwd: args.cwd,
      // `auto` for both: a check run right after the agent committed is exactly
      // when the working tree is empty and the commits are the whole patch, and
      // a gate that reported "clean" there was answering a question nobody
      // asked. `auto` still starts with uncommitted work when there is any.
      // A session base is a commit, and it is wanted literally: everything from
      // there to now, commits and working tree alike. Fork-pointing it would
      // resolve to itself anyway, but saying `direct` is saying what is meant.
      base: session ?? args.base ?? 'auto',
      baseMode: session !== null ? 'direct' : args.baseMode,
      staged: args.staged,
      failOn: args.failOn,
      severities: args.severities,
      allowFile: args.allowFile,
      testGlobs: args.testGlobs,
      mode: args.command === 'hook' ? 'hook' : 'check',
      ledger: args.ledger,
      evaluation: args.evaluation,
      env: io.env,
      session: typeof payload.session_id === 'string' ? payload.session_id : undefined,
      stopPayload: payload,
      failOnEmpty: args.failOnEmpty,
      warn: io.stderr,
      untracked: args.untracked,
      exclude: args.exclude,
    });

    if (args.explainBase) {
      const from =
        settingsPath !== null && settings.base !== undefined && !args.explicit.has('--base')
          ? `${settingsPath} -> `
          : '';
      const how = session !== null ? 'this session -> ' : '';
      io.stderr(`overlock: base — ${how}${from}${steps.join(' -> ')}\n`);
    }

    if (outcome) {
      if (outcome.stdout) io.stdout(outcome.stdout);
      if (outcome.stderr) io.stderr(outcome.stderr);
      return outcome.exitCode;
    }

    if (args.format === 'json') io.stdout(`${json(report)}\n`);
    else if (args.format === 'compact') io.stdout(`${compact(report, args.limit)}\n`);
    else io.stdout(`${human(report, useColor({ isTTY: io.isTTY }, io.env))}\n`);

    // An empty patch is not a pass and not an error: nothing was examined, and
    // only the caller knows whether that is expected. `--fail-on-empty` is for
    // the callers for which it never is.
    return exitCode;
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
    check: (call: { base?: string; baseMode?: string; staged?: boolean; failOn?: string }) =>
      run({
        cwd: args.cwd,
        base: call.base ?? args.base ?? 'auto',
        baseMode: call.baseMode === 'direct' ? 'direct' : args.baseMode,
        ...(call.staged === undefined ? {} : { staged: call.staged }),
        failOn: (call.failOn ?? args.failOn) as Severity | 'none',
        severities: args.severities,
        testGlobs: args.testGlobs,
        mode: 'check' as const,
        ledger: args.ledger,
        evaluation: args.evaluation,
        env: io.env,
        source: 'mcp',
        warn: io.stderr,
        untracked: args.untracked,
        exclude: args.exclude,
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

/**
 * What is in force, and where it came from.
 *
 * The question this answers is the one that made the drift expensive: three
 * surfaces, three answers, and no way to ask any of them what it thought.
 */
function runConfig(args: ParsedArgs, config: OverlockConfig, path: string | null, io: Io): number {
  const effective = {
    base: args.base ?? 'auto',
    baseMode: args.baseMode,
    failOn: args.failOn,
    failOnEmpty: args.failOnEmpty,
    severity: args.severities,
    testGlob: args.testGlobs.map((r) => r.source),
    untracked: args.untracked,
    exclude: args.exclude,
    evaluation: args.evaluation ?? null,
  };

  /** The flag that would set each setting, so each line can say who won. */
  const FLAGS: Record<string, string> = {
    base: '--base',
    baseMode: '--base-mode',
    failOn: '--fail-on',
    failOnEmpty: '--fail-on-empty',
    severity: '--severity',
    testGlob: '--test-glob',
    untracked: '--no-untracked',
    evaluation: '--no-evaluation',
  };

  const origin = (key: string): 'flag' | 'config' | 'default' => {
    // `exclude` has no flag: it names paths the repository keeps, not a choice
    // one invocation should be able to make differently.
    const flag = FLAGS[key];
    if (flag !== undefined && args.explicit.has(flag)) return 'flag';
    return Object.hasOwn(config, key) ? 'config' : 'default';
  };

  if (args.format === 'json') {
    const sources = Object.fromEntries(Object.keys(effective).map((key) => [key, origin(key)]));
    io.stdout(
      `${JSON.stringify({ source: path, declared: config, effective, from: sources }, null, 2)}\n`,
    );
    return 0;
  }

  io.stdout(
    path === null ? 'overlock: no config file; built-in defaults\n' : `overlock: ${path}\n`,
  );
  for (const [key, value] of Object.entries(effective)) {
    io.stdout(`  ${key} = ${JSON.stringify(value)}  (${origin(key)})\n`);
  }
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
