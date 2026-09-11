import { performance } from 'node:perf_hooks';
import { stopHookOutcome, type HookOutcome } from './hook.js';
import {
  BUILD,
  VERSION,
  evaluationIdentity,
  captureEvaluationDiff,
  evaluationFindings,
  fingerprint,
  persistEvaluation,
  type EvaluationConfig,
  type EvaluationRun,
} from './evaluation-record.js';
import { analyze } from './analyze.js';
import { readFileSync } from 'node:fs';
import {
  type BaseMode,
  currentBranch,
  explainRange,
  rangeScope,
  readDiff,
  readMessages,
  repoRoot,
  revision,
  untrackedDiff,
  untrackedFiles,
} from './git.js';
import { appendLedger, toEntry } from './ledger.js';
import type { Finding, Grade, Report, RuleId, Severity } from './types.js';

export interface RunOptions {
  cwd: string;
  base?: string | undefined;
  /** How an explicit `base` is read. Default `fork-point`. */
  baseMode?: BaseMode | undefined;
  staged?: boolean | undefined;
  failOn?: Severity | 'none';
  /** Per-rule grade, replacing the built-in one. `off` drops the rule's findings. */
  severities?: Partial<Record<RuleId, Grade>>;
  testGlobs?: RegExp[];
  mode?: 'check' | 'hook';
  ledger?: boolean;
  evaluation?: EvaluationConfig | undefined;
  env?: NodeJS.ProcessEnv;
  source?: string;
  session?: string | undefined;
  stopPayload?: { stop_hook_active?: boolean };
  failOnEmpty?: boolean;
  warn?: (message: string) => void;
  /** Include files git does not track yet. Default true, except for --staged. */
  untracked?: boolean;
  /**
   * A file holding extra text to read `Overlock-Allow:` trailers from — the
   * pull request body, in the action. The commit messages in the range are read
   * regardless.
   */
  allowFile?: string | undefined;
}

export interface RunResult {
  report: Report;
  outcome?: HookOutcome;
  exitCode: number;
  repo: string;
  branch: string;
  /** How the range was chosen, in order. Printed by `--explain-base`. */
  steps: string[];
}

/** Acquire the diff, apply the rules, record the run. */
export function run(options: RunOptions): RunResult {
  const {
    cwd,
    base,
    baseMode,
    staged,
    failOn = 'high',
    severities = {},
    testGlobs = [],
    mode = 'check',
    ledger = true,
    untracked,
    allowFile,
  } = options;

  const started = performance.now();
  const env = options.env ?? process.env;
  const warn =
    options.warn ??
    ((message: string) => {
      process.stderr.write(message);
    });
  const identity = evaluationIdentity(env, options.session);
  const record: EvaluationRun = {
    schema: 2,
    ...identity,
    timestamp: new Date().toISOString(),
    repository: options.evaluation?.repository ?? '',
    version: VERSION,
    build: BUILD,
    source:
      env.OVERLOCK_SOURCE ||
      options.source ||
      (env.CI ? 'ci' : mode === 'hook' ? 'hook' : 'manual'),
    branch: null,
    base: null,
    head: null,
    patch: null,
    settings: {
      base: base ?? 'auto',
      baseMode: baseMode ?? 'fork-point',
      staged: staged ?? false,
      failOn,
      failOnEmpty: options.failOnEmpty ?? false,
      severity: severities,
      testGlob: testGlobs.map((r) => r.source),
      untracked: untracked ?? !staged,
    },
    scope: null,
    duration_ms: 0,
    status: 'error',
    decision: 'error',
    exit_code: 2,
    error: null,
    findings: [],
  };
  let root = cwd;
  try {
    const repo = repoRoot(cwd);
    root = repo;
    const branch = currentBranch(cwd);
    record.branch = branch;
    record.head = revision('HEAD', cwd);
    const { range, steps } = explainRange({ cwd, base, baseMode, staged });

    record.base = revision(range === '--cached' ? 'HEAD' : range, cwd);

    // Untracked files are part of the working tree but not of any diff against
    // it, so they are appended explicitly. Not for `--staged`, where the question
    // asked is specifically what the index holds.
    const includeUntracked = untracked ?? range !== '--cached';
    record.settings.untracked = includeUntracked;
    const untrackedChunk = includeUntracked ? untrackedDiff(cwd, untrackedFiles(cwd)) : '';
    const diff = readDiff(range, cwd) + untrackedChunk;
    record.patch = fingerprint(diff);
    if (options.evaluation?.captureDiff && env.OVERLOCK_NO_EVALUATION !== '1')
      captureEvaluationDiff(root, diff, warn);

    // Unreadable is the same as absent: a missing pull request body must never be
    // the reason a gate stops gating.
    let allowText = readMessages(range, cwd);
    if (allowFile !== undefined) {
      try {
        allowText += `\n${readFileSync(allowFile, 'utf8')}`;
      } catch {
        // Nothing to add.
      }
    }

    let produced: Finding[] = [];
    const analyzed = analyze({
      diff,
      base: range,
      testGlobs,
      failOn,
      severities,
      allowText,
      onFindings: (findings) => {
        produced = findings;
      },
    });

    // Counted so that a run can say what it read and an empty patch cannot pass
    // for a clean one. The untracked files are counted from the synthesised diff
    // rather than from the path list, because that list is filtered on the way in
    // — a directory, a symlink, a binary or an oversized file is listed and then
    // not diffed, and claiming it was examined would be the same lie in miniature.
    const tracked = rangeScope(range, cwd);
    const report: Report = {
      ...analyzed,
      scope: {
        files: tracked.files + (untrackedChunk.match(/^diff --git /gm) ?? []).length,
        commits: tracked.commits,
      },
    };

    const outcome =
      mode === 'hook' ? stopHookOutcome(report, options.stopPayload ?? {}) : undefined;
    const empty = report.scope?.files === 0;
    const exitCode = outcome?.exitCode ?? (!report.ok || (options.failOnEmpty && empty) ? 1 : 0);
    if (
      ledger &&
      !appendLedger(toEntry({ report, repo, branch, mode, blocked: outcome?.exitCode === 2 }))
    )
      warn('overlock: legacy ledger could not be saved.\n');

    record.scope = report.scope ?? null;
    record.status = empty ? 'empty' : 'analyzed';
    record.exit_code = exitCode;
    record.decision = outcome
      ? exitCode === 2
        ? report.ok
          ? 'suppression_block'
          : 'block'
        : !report.ok || report.suppressed_new > 0 || report.allowed.length > 0
          ? 'retry_bypass'
          : 'pass'
      : exitCode === 0
        ? 'pass'
        : 'fail';
    record.findings = evaluationFindings(
      record.repository,
      record.patch,
      produced,
      report,
      severities,
    );
    return { report, repo, branch, steps, exitCode, ...(outcome ? { outcome } : {}) };
  } catch (error) {
    // The stack and absolute paths are machine-specific; retain the failure category.
    record.error = error instanceof Error ? error.name : 'UnknownError';
    throw error;
  } finally {
    record.duration_ms = Math.round(performance.now() - started);
    if (options.evaluation && env.OVERLOCK_NO_EVALUATION !== '1')
      persistEvaluation(root, record, warn);
  }
}
