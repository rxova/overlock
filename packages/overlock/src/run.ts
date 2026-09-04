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
  untrackedDiff,
  untrackedFiles,
} from './git.js';
import { appendLedger, toEntry } from './ledger.js';
import type { Report, RuleId, Severity } from './types.js';

export interface RunOptions {
  cwd: string;
  base?: string | undefined;
  /** How an explicit `base` is read. Default `fork-point`. */
  baseMode?: BaseMode | undefined;
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

  const repo = repoRoot(cwd);
  const branch = currentBranch(cwd);
  const { range, steps } = explainRange({ cwd, base, baseMode, staged });

  // Untracked files are part of the working tree but not of any diff against
  // it, so they are appended explicitly. Not for `--staged`, where the question
  // asked is specifically what the index holds.
  const includeUntracked = untracked ?? range !== '--cached';
  const untrackedChunk = includeUntracked ? untrackedDiff(cwd, untrackedFiles(cwd)) : '';
  const diff = readDiff(range, cwd) + untrackedChunk;

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

  const analyzed = analyze({ diff, base: range, testGlobs, failOn, severities, allowText });

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

  if (ledger) {
    appendLedger(toEntry({ report, repo, branch, mode, blocked: mode === 'hook' && !report.ok }));
  }

  return { report, repo, branch, steps };
}
