import { execFileSync } from 'node:child_process';

export class GitError extends Error {}

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
    throw new GitError(`git ${args.join(' ')} failed`, { cause: error });
  }
}

export function repoRoot(cwd: string): string {
  return git(['rev-parse', '--show-toplevel'], cwd).trim();
}

export function currentBranch(cwd: string): string {
  return git(['rev-parse', '--abbrev-ref', 'HEAD'], cwd).trim();
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
 */
export function resolveRange(options: RangeOptions): string {
  const { cwd, base, staged } = options;

  if (staged) return '--cached';
  if (base && base !== 'auto') return base;
  if (base === undefined) return 'HEAD';

  const dirty = git(['status', '--porcelain'], cwd).trim();
  if (dirty) return 'HEAD';

  const branch = currentBranch(cwd);
  const trunk = defaultBranch(cwd);
  if (trunk && branch !== trunk && branch !== 'HEAD') {
    try {
      const mergeBase = git(['merge-base', trunk, 'HEAD'], cwd).trim();
      const ahead = git(['rev-list', '--count', `${mergeBase}..HEAD`], cwd).trim();
      if (mergeBase && ahead !== '0') return mergeBase;
    } catch {
      // Unrelated histories, or the trunk ref is not reachable from here.
    }
  }

  // A repository with exactly one commit has no HEAD~1 to compare against.
  try {
    git(['rev-parse', '--verify', '--quiet', 'HEAD~1'], cwd);
    return 'HEAD~1';
  } catch {
    return EMPTY_TREE;
  }
}

/** git's canonical empty tree, so the first commit in a repo can be diffed. */
export const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';

export function readDiff(range: string, cwd: string): string {
  const args = [
    'diff',
    '--no-color',
    '--no-ext-diff',
    // Renames matter: a test file renamed out of the runner's glob is one of
    // the nine things this tool looks for, and without -M it reads as an
    // unrelated add plus delete.
    '--find-renames',
    '--unified=3',
  ];

  if (range === '--cached') args.push('--cached');
  else args.push(range);

  return git(args, cwd);
}
