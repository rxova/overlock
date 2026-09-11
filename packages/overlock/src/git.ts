import { execFileSync } from 'node:child_process';
import { lstatSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export class GitError extends Error {
  /**
   * Advice that only makes sense for a git invocation that failed, so a
   * refused ref is not told to check whether it is in a repository.
   */
  readonly hint: string | undefined;

  constructor(message: string, options?: ErrorOptions & { hint?: string }) {
    super(message, options);
    this.hint = options?.hint;
  }
}

/**
 * All git access goes through execFileSync with an argument array — never a
 * shell string. Branch names, refs and paths are attacker-influenced in the
 * one scenario this tool exists for (an agent wrote them), and a tool that
 * reads a diff to find tampering should not be the thing that runs it.
 */
function git(args: string[], cwd: string): string {
  try {
    return execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (error) {
    throw new GitError(`git ${args.join(' ')} failed`, {
      cause: error,
      hint: 'Is this a git repository?',
    });
  }
}

/**
 * Refuses a "ref" that git would read as an option.
 *
 * `git diff --output=FILE` writes wherever it is pointed, and the ref reaches
 * this code from `--base` and from the MCP `base` argument — so without this,
 * any MCP client, or an agent that read a hostile instruction somewhere, could
 * overwrite a shell profile or an authorized_keys as the user. `--ext-diff`
 * would likewise undo the `--no-ext-diff` that keeps external diff drivers from
 * running.
 *
 * No legitimate ref starts with a dash: git itself rejects such branch names.
 */
export function assertSafeRef(ref: string): void {
  if (ref.startsWith('-')) {
    throw new GitError(
      `refusing to treat ${JSON.stringify(ref)} as a ref: it looks like an option`,
    );
  }
}

export function repoRoot(cwd: string): string {
  return git(['rev-parse', '--show-toplevel'], cwd).trim();
}

/**
 * `--show-current` rather than `rev-parse --abbrev-ref HEAD`, which fails
 * outright before the first commit — so a freshly initialised repository used
 * to be reported as "not a git repository". It returns empty on a detached
 * HEAD, which is what the old form spelled `HEAD`.
 */
export function currentBranch(cwd: string): string {
  return git(['branch', '--show-current'], cwd).trim() || 'HEAD';
}

/** False in a repository that has been initialised but never committed to. */
export function hasCommits(cwd: string): boolean {
  try {
    git(['rev-parse', '--verify', '--quiet', 'HEAD'], cwd);
    return true;
  } catch {
    return false;
  }
}

/**
 * The default branch as this clone understands it, falling back through the
 * common names. `origin/HEAD` is the honest answer but it is only present when
 * the clone was made with it or `git remote set-head` has been run, which is
 * often not true in CI or in a fresh agent sandbox.
 */
export function defaultBranch(cwd: string): string | null {
  try {
    const head = git(['symbolic-ref', '--quiet', 'refs/remotes/origin/HEAD'], cwd).trim();
    const name = head.replace(/^refs\/remotes\/origin\//, '');
    if (name) return name;
  } catch {
    // No origin/HEAD in this clone; fall through to the conventional names.
  }

  for (const candidate of ['main', 'master', 'develop']) {
    try {
      git(['rev-parse', '--verify', '--quiet', `refs/heads/${candidate}`], cwd);
      return candidate;
    } catch {
      continue;
    }
  }
  return null;
}

export interface RangeOptions {
  cwd: string;
  /** An explicit ref, `auto`, or undefined for the working tree. */
  base?: string | undefined;
  staged?: boolean | undefined;
  /**
   * How an explicit ref is read. `fork-point` diffs against where this branch
   * left that ref; `direct` diffs against the ref itself.
   */
  baseMode?: BaseMode | undefined;
}

/** See `RangeOptions.baseMode`. */
export type BaseMode = 'fork-point' | 'direct';

/**
 * A resolved range and the reasoning that produced it.
 *
 * The steps exist because every base bug this tool has had was survivable on
 * its own and expensive only because nothing said which patch had been read.
 * `--explain-base` prints them.
 */
export interface ResolvedRange {
  /** What is handed to `git diff`. */
  range: string;
  /** How it was chosen, in the order it was decided. */
  steps: string[];
}

/**
 * Resolves what "this patch" means, in the order that matches how the tool is
 * actually invoked.
 *
 * `auto` is what the Stop hook uses, and it is the interesting case: an agent
 * may have left its work uncommitted, or committed it to a feature branch, and
 * the check has to cover both without the caller knowing which happened. So:
 * uncommitted changes if there are any, otherwise the branch's commits since it
 * left the default branch, otherwise the last commit.
 *
 * An explicit ref is a fork point, not the ref itself. `git diff main` compares
 * main's tip to this working tree, so the moment main moves ahead, every file
 * main gained reads as a deletion in this branch — a test file among them is
 * reported as TEST_REMOVED, at HIGH, for a branch that never touched it. What
 * a caller passing `--base main` means is `main...HEAD`: what this branch did
 * since it left main. `--base-mode direct` asks for the literal comparison.
 */
export function explainRange(options: RangeOptions): ResolvedRange {
  const { cwd, base, staged, baseMode = 'fork-point' } = options;
  const steps: string[] = [];

  if (staged) {
    steps.push('--staged: the index');
    return { range: '--cached', steps };
  }

  if (base && base !== 'auto') {
    assertSafeRef(base);
    steps.push(`explicit --base ${base}`);

    if (baseMode === 'direct') {
      steps.push('--base-mode direct: comparing against the ref itself');
      return { range: base, steps };
    }
    if (!hasCommits(cwd)) {
      steps.push('no commits here yet, so there is no fork point to find');
      return { range: base, steps };
    }

    try {
      const mergeBase = git(['merge-base', base, 'HEAD'], cwd).trim();
      if (mergeBase) {
        steps.push(`fork point with ${base} is ${mergeBase.slice(0, 7)}`);
        return { range: mergeBase, steps };
      }
      steps.push(`no fork point with ${base}; comparing against the ref itself`);
    } catch {
      // Unrelated histories, or a ref that names something git cannot merge-base
      // (a tree, a tag object). The literal comparison is still answerable.
      steps.push(`no common history with ${base}; comparing against the ref itself`);
    }
    return { range: base, steps };
  }

  // Nothing to diff against before the first commit, so everything in the tree
  // is an addition. An agent scaffolding a new project is exactly that case,
  // and it used to be reported as "not a git repository". Checked after an
  // explicit ref, which the caller means literally either way.
  if (!hasCommits(cwd)) {
    steps.push('no commits yet: everything in the tree is an addition');
    return { range: EMPTY_TREE, steps };
  }

  if (base === undefined) {
    steps.push('no --base: the working tree');
    return { range: 'HEAD', steps };
  }

  steps.push('auto');

  const dirty = git(['status', '--porcelain', '--', '.', ':(top,exclude).overlock'], cwd).trim();
  if (dirty) {
    steps.push('uncommitted changes present: the working tree');
    return { range: 'HEAD', steps };
  }
  steps.push('nothing uncommitted');

  const branch = currentBranch(cwd);
  const trunk = defaultBranch(cwd);
  if (trunk && branch !== trunk && branch !== 'HEAD') {
    try {
      const mergeBase = git(['merge-base', trunk, 'HEAD'], cwd).trim();
      const ahead = git(['rev-list', '--count', `${mergeBase}..HEAD`], cwd).trim();
      if (mergeBase && ahead !== '0') {
        steps.push(
          `${branch} is ${ahead} commit(s) ahead of ${trunk} since ${mergeBase.slice(0, 7)}`,
        );
        return { range: mergeBase, steps };
      }
      steps.push(`${branch} is level with ${trunk}`);
    } catch {
      // Unrelated histories, or the trunk ref is not reachable from here.
      steps.push(`no common history with ${trunk}`);
    }
  } else if (trunk) {
    steps.push(`on ${trunk} itself, so there are no branch commits to read`);
  } else {
    steps.push('no default branch to measure against');
  }

  // A repository with exactly one commit has no HEAD~1 to compare against.
  try {
    git(['rev-parse', '--verify', '--quiet', 'HEAD~1'], cwd);
    steps.push('falling back to the last commit');
    return { range: 'HEAD~1', steps };
  } catch {
    steps.push('only one commit here, so it is the whole patch');
    return { range: EMPTY_TREE, steps };
  }
}

/** The range alone, for callers with nothing to explain. */
export function resolveRange(options: RangeOptions): string {
  return explainRange(options).range;
}

/**
 * How much the range actually covers, so a run can say what it examined.
 *
 * Counted from git rather than from the parsed diff: untracked files are added
 * to the diff afterwards, and a caller comparing "83 files" against `git diff
 * --stat` should get the same number.
 */
export function rangeScope(range: string, cwd: string): { files: number; commits: number } {
  const files = countLines(
    range === '--cached'
      ? git(['diff', '--cached', '--name-only', '--', '.', ':(top,exclude).overlock'], cwd)
      : git(['diff', '--name-only', range, '--', '.', ':(top,exclude).overlock'], cwd),
  );

  if (range === '--cached' || range === 'HEAD') return { files, commits: 0 };

  try {
    const commits = Number(git(['rev-list', '--count', `${range}..HEAD`], cwd).trim());
    return { files, commits: Number.isFinite(commits) ? commits : 0 };
  } catch {
    return { files, commits: 0 };
  }
}

const countLines = (text: string): number => text.split('\n').filter(Boolean).length;

/**
 * The last commit made at or before a moment, or null when there is none.
 *
 * At or before, not before: git's `--before` is inclusive, and it works in whole
 * seconds. Callers wanting a strict boundary subtract one.
 *
 * This is how a session gets a base: everything the agent committed during it,
 * plus whatever it left in the working tree, is `<that commit>..now`. `--before`
 * reads committer date, which is the one git updates on a rebase or an amend —
 * so work rewritten during the session stays inside the session's range, which
 * is the conservative direction and the correct one.
 */
export function commitBefore(when: Date, cwd: string): string | null {
  try {
    const sha = git(['rev-list', '-1', `--before=${when.toISOString()}`, 'HEAD'], cwd).trim();
    return sha || null;
  } catch {
    // No commits, or no HEAD. Either way there is no "before" to point at.
    return null;
  }
}

/** git's canonical empty tree, so the first commit in a repo can be diffed. */
export const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';

/**
 * The commit messages in the range, for `Overlock-Allow:` trailers.
 *
 * Empty for the working tree and for a staged check, which is the honest
 * answer: uncommitted work has no commit message to read. A session-scoped Stop
 * hook does have commits in its range, so a trailer written during the session
 * is read there. Failure is empty rather than fatal — a range with no commits
 * in it is the normal case, not an error.
 */
export function readMessages(range: string, cwd: string): string {
  if (range === '--cached' || range === EMPTY_TREE || range === 'HEAD') return '';

  assertSafeRef(range);
  try {
    return git(['log', '--format=%B', `${range}..HEAD`, '--'], cwd);
  } catch {
    return '';
  }
}

export function readDiff(range: string, cwd: string): string {
  const args = [
    'diff',
    '--no-color',
    '--no-ext-diff',
    // Renames matter: a test file renamed out of the runner's glob is one of
    // the things this tool looks for, and without -M it reads as an
    // unrelated add plus delete.
    '--find-renames',
    '--unified=3',
  ];

  if (range === '--cached') {
    args.push('--cached');
  } else {
    // Checked here as well as where the range is resolved: this is the boundary
    // that actually hands the value to git, and it is exported.
    assertSafeRef(range);
    args.push(range);
  }

  // Everything after this is a pathspec, so nothing downstream can be read as
  // an option even if a future caller forgets the check above.
  args.push('--', '.', ':(top,exclude).overlock');

  return git(args, cwd);
}

/**
 * Paths git knows nothing about yet, honouring .gitignore.
 *
 * `-z` rather than newline-delimited: a path with a space, a newline or a
 * non-ASCII byte comes back quoted and escaped otherwise, and this list is fed
 * straight into path matching.
 */
export function untrackedFiles(cwd: string): string[] {
  return git(
    ['ls-files', '--others', '--exclude-standard', '-z', '--', '.', ':(top,exclude).overlock'],
    cwd,
  )
    .split('\0')
    .filter(Boolean);
}

/** Files above this are not what anyone hand-wrote as a test. */
const MAX_UNTRACKED_BYTES = 2 * 1024 * 1024;

/**
 * Renders untracked files as added-file hunks, so the rules see them.
 *
 * This exists because `git diff HEAD` does not report untracked files at all —
 * which meant a brand-new test file arriving already skipped passed completely
 * clean. Creating a test file is the most ordinary thing an agent does, so that
 * was a hole straight through the middle of what this tool claims to check.
 *
 * The obvious fix is `git add -N`, and it is wrong: it writes to the index of a
 * repository the tool promised only to read. So the diff is synthesised here
 * instead, in exactly the shape the parser already accepts.
 */
export function untrackedDiff(cwd: string, paths: string[]): string {
  const chunks: string[] = [];

  for (const path of paths) {
    const absolute = join(cwd, path);

    let contents: string;
    try {
      // lstat, not stat: a symlink is followed by readFileSync, so an untracked
      // link is a way to make this tool read a file outside the repository and
      // print its contents as evidence. Nothing in a repository needs its
      // symlinks read to answer the question this tool asks.
      const stats = lstatSync(absolute);
      if (!stats.isFile()) continue;
      if (stats.size > MAX_UNTRACKED_BYTES) continue;
      contents = readFileSync(absolute, 'utf8');
    } catch {
      // Vanished between listing and reading, or is not readable. Either way
      // there is nothing to report and this must not fail the run.
      continue;
    }

    // A NUL byte in text decoded as UTF-8 means it was never text. git makes
    // the same call, and reports `Binary files differ` rather than a hunk.
    if (contents.includes('\u0000')) continue;

    const lines = contents.split('\n');
    // A trailing newline splits into a final empty element that is not a line.
    if (lines.at(-1) === '') lines.pop();
    if (lines.length === 0) continue;

    chunks.push(
      [
        `diff --git a/${path} b/${path}`,
        'new file mode 100644',
        '--- /dev/null',
        `+++ b/${path}`,
        `@@ -0,0 +1,${lines.length} @@`,
        ...lines.map((line) => `+${line}`),
        '',
      ].join('\n'),
    );
  }

  return chunks.join('');
}

/** Immutable revision identifiers for portable evaluation records. */
export function revision(ref: string, cwd: string): string | null {
  assertSafeRef(ref);
  try {
    return git(['rev-parse', '--verify', ref], cwd).trim();
  } catch {
    return null;
  }
}
