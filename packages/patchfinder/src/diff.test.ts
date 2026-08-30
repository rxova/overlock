import { describe, expect, it } from 'vitest';
import { addedLines, parseDiff, removedLines } from './diff.js';
import { diffOf, hunk } from './__fixtures__/diffs.js';

describe('parseDiff', () => {
  it('returns nothing for an empty diff', () => {
    expect(parseDiff('')).toEqual([]);
  });

  it('reads paths, status and hunk line numbers', () => {
    const raw = diffOf(
      'src/auth.ts',
      hunk([' const a = 1;', '-const b = 2;', '+const b = 3;'].join('\n'), 10, 10),
    );
    const [file] = parseDiff(raw);

    expect(file?.path).toBe('src/auth.ts');
    expect(file?.status).toBe('modified');
    expect(file?.hunks).toHaveLength(1);

    const lines = file?.hunks[0]?.lines ?? [];
    expect(lines.map((l) => l.kind)).toEqual(['ctx', 'del', 'add']);
    expect(lines[0]?.oldLine).toBe(10);
    expect(lines[1]?.oldLine).toBe(11);
    expect(lines[2]?.newLine).toBe(11);
  });

  it('marks additions and deletions, and names a deleted file by its pre-image', () => {
    const added = parseDiff(diffOf('a.ts', hunk('+const x = 1;'), { status: 'added' }));
    expect(added[0]?.status).toBe('added');

    const deleted = parseDiff(diffOf('gone.test.ts', hunk('-const x = 1;'), { status: 'deleted' }));
    expect(deleted[0]?.status).toBe('deleted');
    expect(deleted[0]?.path).toBe('gone.test.ts');
  });

  it('follows a rename', () => {
    const raw = diffOf('src/login.helpers.ts', hunk(' const x = 1;'), {
      oldPath: 'src/login.test.ts',
    });
    const [file] = parseDiff(raw);

    expect(file?.status).toBe('renamed');
    expect(file?.oldPath).toBe('src/login.test.ts');
    expect(file?.path).toBe('src/login.helpers.ts');
  });

  it('parses several files in one diff', () => {
    const raw = diffOf('a.ts', hunk('+1')) + diffOf('b.ts', hunk('+2'));
    expect(parseDiff(raw).map((f) => f.path)).toEqual(['a.ts', 'b.ts']);
  });

  it('handles quoted paths that contain spaces', () => {
    const raw = [
      'diff --git "a/src/my file.ts" "b/src/my file.ts"',
      '--- "a/src/my file.ts"',
      '+++ "b/src/my file.ts"',
      hunk('+const x = 1;'),
    ].join('\n');

    expect(parseDiff(raw)[0]?.path).toBe('src/my file.ts');
  });

  it('splits an unquoted pair of paths that contain spaces', () => {
    const raw = [
      'diff --git a/my file.ts b/my file.ts',
      '--- a/my file.ts',
      '+++ b/my file.ts',
      hunk('+const x = 1;'),
    ].join('\n');

    expect(parseDiff(raw)[0]?.path).toBe('my file.ts');
  });

  it('skips binary files rather than guessing at them', () => {
    const raw = [
      'diff --git a/logo.png b/logo.png',
      'Binary files a/logo.png and b/logo.png differ',
    ].join('\n');
    const [file] = parseDiff(raw);
    expect(file?.path).toBe('logo.png');
    expect(file?.hunks).toEqual([]);
  });

  it('ignores the no-newline marker', () => {
    const raw = diffOf('a.ts', `${hunk('+const x = 1;')}\n\\ No newline at end of file`);
    expect(parseDiff(raw)[0]?.hunks[0]?.lines).toHaveLength(1);
  });

  it('ignores content before the first file header', () => {
    expect(parseDiff('some preamble\n+not a real line')).toEqual([]);
  });

  it('flattens added and removed lines', () => {
    const raw = diffOf('a.ts', hunk([' ctx', '-old', '+new'].join('\n')));
    const [file] = parseDiff(raw);
    if (!file) throw new Error('expected a file');

    expect(addedLines(file).map((l) => l.text)).toEqual(['new']);
    expect(removedLines(file).map((l) => l.text)).toEqual(['old']);
  });
});
