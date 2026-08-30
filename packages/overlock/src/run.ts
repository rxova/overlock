import { analyze } from './analyze.js';
import { currentBranch, readDiff, repoRoot, resolveRange } from './git.js';
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
  } = options;

  const repo = repoRoot(cwd);
  const branch = currentBranch(cwd);
  const range = resolveRange({ cwd, base, staged });
  const diff = readDiff(range, cwd);

  const report = analyze({ diff, base: range, testGlobs, failOn });

  if (ledger) {
    appendLedger(toEntry({ report, repo, branch, mode, blocked: mode === 'hook' && !report.ok }));
  }

  return { report, repo, branch };
}
