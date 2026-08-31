import { afterEach, describe, expect, it } from 'vitest';
import {
  EMPTY_TREE,
  GitError,
  currentBranch,
  defaultBranch,
  hasCommits,
  readDiff,
  repoRoot,
  resolveRange,
} from './git.js';
import { PASSING_TEST, SKIPPED_TEST, TempRepo } from './__fixtures__/repo.js';

let repo: TempRepo | null = null;

function makeRepo(): TempRepo {
  repo = new TempRepo();
  return repo;
}

afterEach(() => {
  repo?.cleanup();
  repo = null;
});

describe('repository facts', () => {
  it('finds the root and the branch', () => {
    const r = makeRepo();
    r.write('a.txt', 'hello\n');
    r.commit('feat: first');

    // macOS resolves the temp dir through a symlink, so compare the basenames.
    expect(repoRoot(r.dir).split('/').pop()).toBe(r.dir.split('/').pop());
    expect(currentBranch(r.dir)).toBe('main');
  });

  it('reports the default branch by name when there is no origin', () => {
    const r = makeRepo();
    r.write('a.txt', 'hello\n');
    r.commit('feat: first');
    expect(defaultBranch(r.dir)).toBe('main');
  });

  it('has no default branch before the first commit', () => {
    const r = makeRepo();
    expect(defaultBranch(r.dir)).toBeNull();
  });

  it('raises a typed error outside a repository', () => {
    expect(() => repoRoot('/')).toThrow(GitError);
  });
});

describe('resolveRange', () => {
  it('uses --cached for staged work', () => {
    const r = makeRepo();
    expect(resolveRange({ cwd: r.dir, staged: true })).toBe('--cached');
  });

  it('passes an explicit ref through untouched, even before the first commit', () => {
    const r = makeRepo();
    expect(resolveRange({ cwd: r.dir, base: 'origin/main' })).toBe('origin/main');

    r.write('a.txt', 'one\n');
    r.commit('feat: first');
    expect(resolveRange({ cwd: r.dir, base: 'origin/main' })).toBe('origin/main');
  });

  it('defaults to the working tree when no base is given', () => {
    const r = makeRepo();
    r.write('a.txt', 'one\n');
    r.commit('feat: first');
    expect(resolveRange({ cwd: r.dir })).toBe('HEAD');
  });

  // Before this, a freshly initialised repository reported itself as not being
  // a git repository at all.
  it('falls back to the empty tree before the first commit', () => {
    const r = makeRepo();
    expect(hasCommits(r.dir)).toBe(false);
    expect(resolveRange({ cwd: r.dir })).toBe(EMPTY_TREE);
    expect(resolveRange({ cwd: r.dir, base: 'auto' })).toBe(EMPTY_TREE);
  });

  describe('auto', () => {
    it('picks the working tree when anything is uncommitted', () => {
      const r = makeRepo();
      r.write('a.test.ts', PASSING_TEST);
      r.commit('feat: first');
      r.write('a.test.ts', SKIPPED_TEST);

      expect(resolveRange({ cwd: r.dir, base: 'auto' })).toBe('HEAD');
    });

    it('picks the merge base when a clean feature branch is ahead', () => {
      const r = makeRepo();
      r.write('a.test.ts', PASSING_TEST);
      r.commit('feat: first');
      const base = r.git(['rev-parse', 'HEAD']).trim();

      r.git(['checkout', '--quiet', '-b', 'feature']);
      r.write('a.test.ts', SKIPPED_TEST);
      r.commit('fix: second');

      expect(resolveRange({ cwd: r.dir, base: 'auto' })).toBe(base);
    });

    it('falls back to the previous commit on a clean default branch', () => {
      const r = makeRepo();
      r.write('a.txt', 'one\n');
      r.commit('feat: first');
      r.write('a.txt', 'two\n');
      r.commit('feat: second');

      expect(resolveRange({ cwd: r.dir, base: 'auto' })).toBe('HEAD~1');
    });

    it('falls back to the empty tree when there is only one commit', () => {
      const r = makeRepo();
      r.write('a.txt', 'one\n');
      r.commit('feat: first');

      expect(resolveRange({ cwd: r.dir, base: 'auto' })).toBe(EMPTY_TREE);
    });
  });
});

describe('readDiff', () => {
  it('reads the working tree against HEAD', () => {
    const r = makeRepo();
    r.write('a.test.ts', PASSING_TEST);
    r.commit('feat: first');
    r.write('a.test.ts', SKIPPED_TEST);

    expect(readDiff('HEAD', r.dir)).toContain('it.skip');
  });

  it('reads staged changes', () => {
    const r = makeRepo();
    r.write('a.test.ts', PASSING_TEST);
    r.commit('feat: first');
    r.write('a.test.ts', SKIPPED_TEST);
    r.git(['add', '-A']);

    expect(readDiff('--cached', r.dir)).toContain('it.skip');
  });

  it('detects a rename rather than an add plus a delete', () => {
    const r = makeRepo();
    r.write('a.test.ts', PASSING_TEST);
    r.commit('feat: first');
    r.git(['mv', 'a.test.ts', 'a.helpers.ts']);

    expect(readDiff('HEAD', r.dir)).toContain('rename to a.helpers.ts');
  });
});
