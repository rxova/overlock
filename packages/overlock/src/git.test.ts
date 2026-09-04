import { afterEach, describe, expect, it } from 'vitest';
import {
  EMPTY_TREE,
  GitError,
  currentBranch,
  defaultBranch,
  explainRange,
  hasCommits,
  rangeScope,
  readDiff,
  readMessages,
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

  describe('an explicit ref', () => {
    /** A branch that forked before the trunk moved on — the shape that broke. */
    function forkedRepo(): { repo: TempRepo; fork: string } {
      const r = makeRepo();
      r.write('a.test.ts', PASSING_TEST);
      r.commit('feat: first');
      const fork = r.git(['rev-parse', 'HEAD']).trim();

      r.git(['checkout', '--quiet', '-b', 'feature']);
      r.write('feature.ts', 'export const x = 1;\n');
      r.commit('feat: on the branch');

      r.git(['checkout', '--quiet', 'main']);
      r.write('b.test.ts', PASSING_TEST);
      r.commit('feat: on main, after the fork');
      r.git(['checkout', '--quiet', 'feature']);

      return { repo: r, fork };
    }

    it('resolves to the fork point, not to the ref itself', () => {
      const { repo: r, fork } = forkedRepo();
      // `git diff main` would report b.test.ts — a file this branch never
      // touched — as a deletion, and a deleted test file is a HIGH finding.
      expect(resolveRange({ cwd: r.dir, base: 'main' })).toBe(fork);
      expect(readDiff(resolveRange({ cwd: r.dir, base: 'main' }), r.dir)).not.toContain(
        'b.test.ts',
      );
    });

    it('compares against the ref itself when asked directly', () => {
      const { repo: r } = forkedRepo();
      expect(resolveRange({ cwd: r.dir, base: 'main', baseMode: 'direct' })).toBe('main');
      expect(readDiff('main', r.dir)).toContain('b.test.ts');
    });

    it('falls back to the ref when there is no common history', () => {
      const r = makeRepo();
      r.write('a.txt', 'one\n');
      r.commit('feat: first');
      // A ref this clone has never heard of cannot be merge-based.
      expect(resolveRange({ cwd: r.dir, base: 'origin/main' })).toBe('origin/main');
    });

    it('passes the ref through before the first commit', () => {
      const r = makeRepo();
      expect(resolveRange({ cwd: r.dir, base: 'origin/main' })).toBe('origin/main');
    });

    it('still refuses a ref that looks like an option', () => {
      const r = makeRepo();
      expect(() => resolveRange({ cwd: r.dir, base: '--output=/tmp/pwned' })).toThrow(GitError);
    });
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

describe('explainRange', () => {
  it('says it read the index', () => {
    const r = makeRepo();
    expect(explainRange({ cwd: r.dir, staged: true }).steps).toEqual(['--staged: the index']);
  });

  it('names the fork point it found', () => {
    const r = makeRepo();
    r.write('a.txt', 'one\n');
    r.commit('feat: first');
    r.git(['checkout', '--quiet', '-b', 'feature']);
    r.write('b.txt', 'two\n');
    r.commit('feat: second');

    const { steps } = explainRange({ cwd: r.dir, base: 'main' });
    expect(steps[0]).toBe('explicit --base main');
    expect(steps[1]).toMatch(/^fork point with main is [0-9a-f]{7}$/);
  });

  it('says when it was told to compare directly', () => {
    const r = makeRepo();
    r.write('a.txt', 'one\n');
    r.commit('feat: first');
    expect(explainRange({ cwd: r.dir, base: 'main', baseMode: 'direct' }).steps).toContain(
      '--base-mode direct: comparing against the ref itself',
    );
  });

  it('traces auto all the way to the answer', () => {
    const r = makeRepo();
    r.write('a.txt', 'one\n');
    r.commit('feat: first');
    r.git(['checkout', '--quiet', '-b', 'feature']);
    r.write('b.txt', 'two\n');
    r.commit('feat: second');

    const { steps } = explainRange({ cwd: r.dir, base: 'auto' });
    expect(steps[0]).toBe('auto');
    expect(steps).toContain('nothing uncommitted');
    expect(steps.at(-1)).toMatch(/^feature is 1 commit\(s\) ahead of main since [0-9a-f]{7}$/);
  });

  it('says it stopped at the working tree', () => {
    const r = makeRepo();
    r.write('a.txt', 'one\n');
    r.commit('feat: first');
    r.write('a.txt', 'two\n');

    expect(explainRange({ cwd: r.dir, base: 'auto' }).steps).toContain(
      'uncommitted changes present: the working tree',
    );
    expect(explainRange({ cwd: r.dir }).steps).toEqual(['no --base: the working tree']);
  });

  it('says why it had nothing to measure against', () => {
    const r = makeRepo();
    r.write('a.txt', 'one\n');
    r.commit('feat: first');
    r.write('a.txt', 'two\n');
    r.commit('feat: second');

    const { steps } = explainRange({ cwd: r.dir, base: 'auto' });
    expect(steps).toContain('on main itself, so there are no branch commits to read');
    expect(steps).toContain('falling back to the last commit');
  });

  it('says when the branch is level with the trunk', () => {
    const r = makeRepo();
    r.write('a.txt', 'one\n');
    r.commit('feat: first');
    r.write('a.txt', 'two\n');
    r.commit('feat: second');
    r.git(['checkout', '--quiet', '-b', 'feature']);

    const { range, steps } = explainRange({ cwd: r.dir, base: 'auto' });
    expect(steps).toContain('feature is level with main');
    expect(range).toBe('HEAD~1');
  });

  it('says when there is no common history with the trunk', () => {
    const r = makeRepo();
    r.write('a.txt', 'one\n');
    r.commit('feat: first');
    r.git(['checkout', '--quiet', '--orphan', 'unrelated']);
    r.write('b.txt', 'two\n');
    r.commit('feat: an unrelated root');

    expect(explainRange({ cwd: r.dir, base: 'auto' }).steps).toContain(
      'no common history with main',
    );
  });

  it('says when there is no default branch to measure against', () => {
    const r = makeRepo();
    r.write('a.txt', 'one\n');
    r.commit('feat: first');
    r.write('a.txt', 'two\n');
    r.commit('feat: second');
    // No origin/HEAD, and nothing called main, master or develop.
    r.git(['branch', '--move', 'topic']);

    expect(defaultBranch(r.dir)).toBeNull();
    expect(explainRange({ cwd: r.dir, base: 'auto' }).steps).toContain(
      'no default branch to measure against',
    );
  });

  it('says there are no commits at all', () => {
    const r = makeRepo();
    expect(explainRange({ cwd: r.dir }).steps).toEqual([
      'no commits yet: everything in the tree is an addition',
    ]);
  });
});

describe('rangeScope', () => {
  it('counts the files and commits a range covers', () => {
    const r = makeRepo();
    r.write('a.txt', 'one\n');
    r.commit('feat: first');
    const base = r.git(['rev-parse', 'HEAD']).trim();

    r.write('b.txt', 'two\n');
    r.commit('feat: second');
    r.write('c.txt', 'three\n');
    r.commit('feat: third');

    expect(rangeScope(base, r.dir)).toEqual({ files: 2, commits: 2 });
  });

  it('counts no commits for the working tree or the index', () => {
    const r = makeRepo();
    r.write('a.txt', 'one\n');
    r.commit('feat: first');
    r.write('a.txt', 'two\n');

    expect(rangeScope('HEAD', r.dir)).toEqual({ files: 1, commits: 0 });
    r.git(['add', '-A']);
    expect(rangeScope('--cached', r.dir)).toEqual({ files: 1, commits: 0 });
  });

  it('reports an empty range as empty', () => {
    const r = makeRepo();
    r.write('a.txt', 'one\n');
    r.commit('feat: first');

    expect(rangeScope('HEAD', r.dir)).toEqual({ files: 0, commits: 0 });
  });

  it('counts the whole history against the empty tree', () => {
    const r = makeRepo();
    r.write('a.txt', 'one\n');
    r.commit('feat: first');

    // The first commit in a repository is the whole patch, and git is willing
    // to walk from the empty tree to it.
    expect(rangeScope(EMPTY_TREE, r.dir)).toEqual({ files: 1, commits: 1 });
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

describe('readMessages', () => {
  it('returns the commit messages in the range', () => {
    const r = makeRepo();
    r.write('src/a.test.ts', PASSING_TEST);
    r.commit('feat: the base');
    r.write('src/a.test.ts', SKIPPED_TEST);
    r.git(['add', '-A']);
    r.git(['commit', '-m', 'chore: quarantine\n\nOverlock-Allow: TEST_SKIPPED_ADDED -- see #412']);

    expect(readMessages('HEAD~1', r.dir)).toContain('Overlock-Allow: TEST_SKIPPED_ADDED');
  });

  /**
   * The honest answer for uncommitted work, which is the Stop hook's usual
   * case: there is no commit message, so there is no trailer.
   */
  it('is empty for the working tree, the index and an empty repository', () => {
    const r = makeRepo();
    r.write('src/a.test.ts', PASSING_TEST);
    r.commit('feat: the base');

    expect(readMessages('HEAD', r.dir)).toBe('');
    expect(readMessages('--cached', r.dir)).toBe('');
    expect(readMessages(EMPTY_TREE, r.dir)).toBe('');
  });

  it('is empty rather than fatal when the range cannot be read', () => {
    const r = makeRepo();
    r.write('src/a.test.ts', PASSING_TEST);
    r.commit('feat: the base');

    expect(readMessages('no-such-ref', r.dir)).toBe('');
  });

  it('refuses a ref that git would read as an option', () => {
    const r = makeRepo();
    r.write('src/a.test.ts', PASSING_TEST);
    r.commit('feat: the base');

    expect(() => readMessages('--output=/tmp/pwned', r.dir)).toThrow(GitError);
  });
});
