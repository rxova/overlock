import { afterEach, describe, expect, it } from 'vitest';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseDiff } from './diff.js';
import { untrackedDiff, untrackedFiles } from './git.js';
import { run } from './run.js';
import { PASSING_TEST, SKIPPED_TEST, TempRepo } from './__fixtures__/repo.js';

let repo: TempRepo | null = null;

function repoWithUntrackedTest(contents = SKIPPED_TEST): TempRepo {
  const r = new TempRepo();
  repo = r;
  r.write('src/auth.ts', 'export const check = () => true;\n');
  r.commit('feat: add auth');
  r.write('src/auth.test.ts', contents);
  return r;
}

afterEach(() => {
  repo?.cleanup();
  repo = null;
});

describe('untrackedFiles', () => {
  it('lists what git does not track', () => {
    const r = repoWithUntrackedTest();
    expect(untrackedFiles(r.dir)).toEqual(['src/auth.test.ts']);
  });

  it('honours .gitignore', () => {
    const r = repoWithUntrackedTest();
    r.write('.gitignore', 'src/auth.test.ts\n');
    expect(untrackedFiles(r.dir)).toEqual(['.gitignore']);
  });

  it('is empty for a clean tree', () => {
    const r = new TempRepo();
    repo = r;
    r.write('a.txt', 'one\n');
    r.commit('feat: first');
    expect(untrackedFiles(r.dir)).toEqual([]);
  });
});

describe('untrackedDiff', () => {
  it('renders a file as an added-file hunk the parser accepts', () => {
    const r = repoWithUntrackedTest();
    const [file] = parseDiff(untrackedDiff(r.dir, ['src/auth.test.ts']));

    expect(file?.path).toBe('src/auth.test.ts');
    expect(file?.status).toBe('added');
    expect(file?.hunks[0]?.lines.every((l) => l.kind === 'add')).toBe(true);
    expect(file?.hunks[0]?.lines[0]?.newLine).toBe(1);
  });

  it('numbers lines so a finding points at the right one', () => {
    const r = repoWithUntrackedTest();
    const [file] = parseDiff(untrackedDiff(r.dir, ['src/auth.test.ts']));
    const skip = file?.hunks[0]?.lines.find((l) => l.text.includes('it.skip'));

    expect(skip?.newLine).toBe(SKIPPED_TEST.split('\n').indexOf(skip?.text ?? '') + 1);
  });

  it('skips a binary file rather than guessing at it', () => {
    const r = repoWithUntrackedTest();
    writeFileSync(join(r.dir, 'blob.bin'), Buffer.from([0x00, 0x01, 0x02, 0x00]));
    expect(untrackedDiff(r.dir, ['blob.bin'])).toBe('');
  });

  it('skips an empty file', () => {
    const r = repoWithUntrackedTest();
    r.write('empty.ts', '');
    expect(untrackedDiff(r.dir, ['empty.ts'])).toBe('');
  });

  it('does not throw on a path that is not there', () => {
    const r = repoWithUntrackedTest();
    expect(untrackedDiff(r.dir, ['does/not/exist.ts'])).toBe('');
  });

  it('handles a file with no trailing newline', () => {
    const r = repoWithUntrackedTest();
    r.write('src/b.test.ts', "it.skip('x', () => {})");
    const [file] = parseDiff(untrackedDiff(r.dir, ['src/b.test.ts']));
    expect(file?.hunks[0]?.lines).toHaveLength(1);
  });
});

describe('run', () => {
  // The hole this closes: creating a test file is the most ordinary thing an
  // agent does, and `git diff HEAD` reports nothing at all about one.
  it('catches a skipped test in a brand-new untracked file', () => {
    const r = repoWithUntrackedTest();
    const { report } = run({ cwd: r.dir, base: 'auto', ledger: false });

    expect(report.ok).toBe(false);
    expect(report.findings.map((f) => f.rule)).toContain('TEST_SKIPPED_ADDED');
    expect(report.findings[0]?.file).toBe('src/auth.test.ts');
  });

  it('stays quiet about a new test file that skips nothing', () => {
    const r = repoWithUntrackedTest(PASSING_TEST);
    expect(run({ cwd: r.dir, base: 'auto', ledger: false }).report.ok).toBe(true);
  });

  it('can be turned off', () => {
    const r = repoWithUntrackedTest();
    const { report } = run({ cwd: r.dir, base: 'auto', ledger: false, untracked: false });
    expect(report.findings).toEqual([]);
  });

  it('leaves untracked files out of --staged, which asks about the index', () => {
    const r = repoWithUntrackedTest();
    expect(run({ cwd: r.dir, staged: true, ledger: false }).report.findings).toEqual([]);
  });

  it('never writes to the index — the tool only reads', () => {
    const r = repoWithUntrackedTest();
    const before = r.git(['status', '--porcelain']);
    run({ cwd: r.dir, base: 'auto', ledger: false });
    expect(r.git(['status', '--porcelain'])).toBe(before);
  });
});
