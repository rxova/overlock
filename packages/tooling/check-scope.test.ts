/**
 * Skipping the suite is the dangerous answer, so these cases are mostly about
 * the ways a release commit can fail to be one.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  decideScope,
  git,
  isReleaseMetadata,
  main,
  versionBumpOnly,
  type Git,
} from './check-scope.js';

/** A git stub: names the files a range changed, and the hunks per file. */
const fakeGit = (changed: string[], hunks: Record<string, string> = {}): Git => {
  return (...args: string[]) => {
    if (args[1] === '--name-only') return `${changed.join('\n')}\n`;
    const file = args[args.length - 1] ?? '';
    return hunks[file] ?? '';
  };
};

describe('isReleaseMetadata', () => {
  it.each(['.changeset/tidy-pandas-smile.md', 'CHANGELOG.md', 'packages/overlock/CHANGELOG.md'])(
    'recognises %s',
    (file) => {
      expect(isReleaseMetadata(file)).toBe(true);
    },
  );

  it.each(['.changeset/config.json', 'docs/CHANGELOG.md.txt', 'src/run.ts'])(
    'does not claim %s',
    (file) => {
      expect(isReleaseMetadata(file)).toBe(false);
    },
  );
});

describe('versionBumpOnly', () => {
  const range = { base: 'aaa', head: 'bbb' };

  it('accepts a hunk that touches nothing but the version', () => {
    const diff = [
      '--- a/package.json',
      '+++ b/package.json',
      '-  "version": "0.1.0",',
      '+  "version": "0.1.1",',
    ].join('\n');
    expect(versionBumpOnly('package.json', range, () => diff)).toBe(true);
  });

  it('rejects a bump with anything else riding along', () => {
    const diff = [
      '--- a/package.json',
      '+++ b/package.json',
      '-  "version": "0.1.0",',
      '+  "version": "0.1.1",',
      '+  "dependencies": { "left-pad": "1.3.0" },',
    ].join('\n');
    expect(versionBumpOnly('package.json', range, () => diff)).toBe(false);
  });

  it('rejects a file with no edited lines at all', () => {
    expect(versionBumpOnly('package.json', range, () => '')).toBe(false);
  });
});

describe('decideScope', () => {
  it.each([
    ['no base', undefined, 'bbb'],
    ['no head', 'aaa', undefined],
    ['an all-zero base', '0000000000000000000000000000000000000000', 'bbb'],
  ])('runs everything when there is %s', (_case, base, head) => {
    const verdict = decideScope(base, head, fakeGit(['src/run.ts']));
    expect(verdict.codeChanged).toBe(true);
    expect(verdict.reason).toBe('no usable commit range');
  });

  it('runs everything when the range cannot be diffed', () => {
    const verdict = decideScope('aaa', 'bbb', () => {
      throw new Error('bad object');
    });
    expect(verdict).toEqual({ codeChanged: true, reason: 'could not diff the range' });
  });

  it('runs everything on an empty diff', () => {
    expect(decideScope('aaa', 'bbb', fakeGit([]))).toEqual({
      codeChanged: true,
      reason: 'empty diff',
    });
  });

  it('skips a release commit', () => {
    const changed = [
      'packages/overlock/package.json',
      'packages/overlock/CHANGELOG.md',
      '.changeset/tidy-pandas-smile.md',
    ];
    const verdict = decideScope(
      'aaa',
      'bbb',
      fakeGit(changed, {
        'packages/overlock/package.json': '-  "version": "0.1.0",\n+  "version": "0.1.1",',
      }),
    );
    expect(verdict.codeChanged).toBe(false);
    expect(verdict.reason).toContain('release commit — 3 file(s)');
  });

  it('runs everything when the release commit smuggled a real change in', () => {
    const changed = ['packages/overlock/package.json', 'packages/overlock/src/run.ts'];
    const verdict = decideScope('aaa', 'bbb', fakeGit(changed));
    expect(verdict).toEqual({ codeChanged: true, reason: '2 file(s) changed' });
  });

  it('runs everything when a manifest changed by more than its version', () => {
    const verdict = decideScope(
      'aaa',
      'bbb',
      fakeGit(['package.json'], {
        'package.json': '-  "version": "0.1.0",\n+  "version": "0.1.1",\n+  "sideEffects": false,',
      }),
    );
    expect(verdict.codeChanged).toBe(true);
  });

  it('reaches for a real repository when no git is injected', () => {
    // The range is empty, so the answer is known without knowing the history.
    const head = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    expect(decideScope(head, head).reason).toBe('empty diff');
  });
});

describe('git', () => {
  it('runs the command it is given', () => {
    expect(git('rev-parse', '--is-inside-work-tree').trim()).toBe('true');
  });
});

describe('main', () => {
  const log = vi.spyOn(console, 'log').mockImplementation(() => {});
  afterEach(() => log.mockClear());

  it('prints the reason and the verdict', () => {
    expect(main({ BASE_SHA: 'aaa', HEAD_SHA: 'bbb' }, { run: fakeGit(['src/run.ts']) })).toBe(0);
    expect(log).toHaveBeenCalledWith('check-scope: 1 file(s) changed');
    expect(log).toHaveBeenCalledWith('check-scope: code-changed=true');
  });

  it('writes the output the workflow gates on', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'scope-')), 'output.txt');
    writeFileSync(file, '');
    main(
      { BASE_SHA: 'aaa', HEAD_SHA: 'bbb', GITHUB_OUTPUT: file },
      { run: fakeGit(['CHANGELOG.md']) },
    );
    expect(readFileSync(file, 'utf8')).toBe('code-changed=false\n');
  });

  it('writes no output file when the runner offers none', () => {
    expect(main({ BASE_SHA: '', HEAD_SHA: '' }, { run: fakeGit([]) })).toBe(0);
  });
});

describe('the entry point', () => {
  it('runs the script and reports the verdict', () => {
    const script = new URL('./check-scope.ts', import.meta.url).pathname;
    const out = execFileSync(process.execPath, ['--import', 'tsx', script], {
      encoding: 'utf8',
      env: { ...process.env, BASE_SHA: '', HEAD_SHA: '', GITHUB_OUTPUT: '' },
    });
    expect(out).toContain('check-scope: code-changed=true');
  });
});
