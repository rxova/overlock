import { analyze } from './analyze.js';
import { readFileSync } from 'node:fs';
import {
  currentBranch,
  readDiff,
  readMessages,
  repoRoot,
  resolveRange,
  untrackedDiff,
  untrackedFiles,
} from './git.js';
import { appendLedger, toEntry } from './ledger.js';
import type { Report, RuleId, Severity } from './types.js';

export interface RunOptions {
  cwd: string;
  base?: string | undefined;
  staged?: boolean | undefined;
  failOn?: Severity | 'none';
  /** Per-rule severity, replacing the built-in grade for those rules. */
  severities?: Partial<Record<RuleId, Severity>>;
  testGlobs?: RegExp[];
  mode?: 'check' | 'hook';
  ledger?: boolean;
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
  repo: string;
  branch: string;
}

/** Acquire the diff, apply the rules, record the run. */
export function run(options: RunOptions): RunResult {
  const {
    cwd,
    base,
    staged,
    failOn = 'high',
    severities = {},
    testGlobs = [],
    mode = 'check',
    ledger = true,
    untracked,
    allowFile,
  } = options;

  const repo = repoRoot(cwd);
  const branch = currentBranch(cwd);
  const range = resolveRange({ cwd, base, staged });

  // Untracked files are part of the working tree but not of any diff against
  // it, so they are appended explicitly. Not for `--staged`, where the question
  // asked is specifically what the index holds.
  const includeUntracked = untracked ?? range !== '--cached';
  const diff =
    readDiff(range, cwd) + (includeUntracked ? untrackedDiff(cwd, untrackedFiles(cwd)) : '');

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

  const report = analyze({ diff, base: range, testGlobs, failOn, severities, allowText });

  if (ledger) {
    appendLedger(toEntry({ report, repo, branch, mode, blocked: mode === 'hook' && !report.ok }));
  }

  return { report, repo, branch };
}
