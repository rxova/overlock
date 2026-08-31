import { analyze } from './analyze.js';
import {
  currentBranch,
  readDiff,
  repoRoot,
  resolveRange,
  untrackedDiff,
  untrackedFiles,
} from './git.js';
import { appendLedger, toEntry } from './ledger.js';
import type { Report, Severity } from './types.js';

export interface RunOptions {
  cwd: string;
  base?: string | undefined;
  staged?: boolean | undefined;
  failOn?: Severity | 'none';
  testGlobs?: RegExp[];
  mode?: 'check' | 'hook';
  ledger?: boolean;
  /** Include files git does not track yet. Default true, except for --staged. */
  untracked?: boolean;
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
    testGlobs = [],
    mode = 'check',
    ledger = true,
    untracked,
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

  const report = analyze({ diff, base: range, testGlobs, failOn });

  if (ledger) {
    appendLedger(toEntry({ report, repo, branch, mode, blocked: mode === 'hook' && !report.ok }));
  }

  return { report, repo, branch };
}
