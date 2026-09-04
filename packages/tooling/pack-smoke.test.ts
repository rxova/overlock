/**
 * The real pack:smoke spends a minute packing and installing a tarball. What is
 * worth testing is not that npm works, but that every way a published package
 * can be broken still reaches a non-zero exit — and that the scratch directory
 * is removed however the run ends.
 */
import { existsSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  EXPECTED_RULE_COUNT,
  main,
  packSmoke,
  probeSource,
  shell,
  workspace,
  type Shell,
  type Workspace,
} from './pack-smoke.js';

/** A scratch workspace that records what was written rather than writing it. */
const fakeFs = (files: string[] = ['overlock-0.1.0.tgz']) => {
  const written = new Map<string, string>();
  const removed: string[] = [];
  const fs: Workspace = {
    make: () => '/scratch',
    list: () => files,
    write: (file, contents) => void written.set(file, contents),
    remove: (dir) => void removed.push(dir),
  };
  return { fs, written, removed };
};

/** A shell that answers each command the smoke test runs. */
const fakeSh = (answers: { version?: string; probe?: string } = {}) => {
  const calls: string[][] = [];
  const sh: Shell = (command, args) => {
    calls.push([command, ...args]);
    if (command === 'npx') return `${answers.version ?? '0.1.0'}\n`;
    if (command === 'node') return `${answers.probe ?? 'ok'}\n`;
    return '';
  };
  return { sh, calls };
};

describe('probeSource', () => {
  it('checks the library entry a consumer would import', () => {
    const source = probeSource();
    expect(source).toContain("import { analyze, RULE_IDS } from 'overlock';");
    expect(source).toContain(`RULE_IDS.length !== ${EXPECTED_RULE_COUNT}`);
  });

  it('can be pointed at a different rule count', () => {
    expect(probeSource(12)).toContain('RULE_IDS.length !== 12');
  });
});

describe('packSmoke', () => {
  it('packs, installs, runs the bin and runs the probe, in that order', () => {
    const { fs, written } = fakeFs();
    const { sh, calls } = fakeSh();

    const message = packSmoke({ pkgDir: '/repo/packages/overlock', sh, fs });

    expect(message).toBe('pack:smoke ok — overlock@0.1.0 installs and runs from a tarball');
    expect(calls.map(([command]) => command)).toEqual(['npm', 'npm', 'npx', 'node']);
    expect(calls[0]).toEqual(['npm', 'pack', '--pack-destination', '/scratch']);
    expect(calls[1]).toContain('/scratch/overlock-0.1.0.tgz');
    expect(calls[2]).toEqual(['npx', '--no-install', 'overlock', '--version']);
    expect(calls[3]).toEqual(['node', '/scratch/probe.mjs']);
    expect(written.get('/scratch/package.json')).toBe('{"name":"scratch","private":true}');
    expect(written.get('/scratch/probe.mjs')).toContain("from 'overlock'");
  });

  it('fails when npm pack wrote no tarball', () => {
    const { fs } = fakeFs([]);
    expect(() => packSmoke({ pkgDir: '/repo', sh: fakeSh().sh, fs })).toThrow(
      'npm pack produced no tarball',
    );
  });

  it('fails when the published bin reports something that is not a version', () => {
    expect(() =>
      packSmoke({
        pkgDir: '/repo',
        sh: fakeSh({ version: 'command not found' }).sh,
        fs: fakeFs().fs,
      }),
    ).toThrow('published bin reported an unusable version: command not found');
  });

  it('fails when the library entry does not resolve', () => {
    expect(() =>
      packSmoke({
        pkgDir: '/repo',
        sh: fakeSh({ probe: 'ERR_PACKAGE_PATH_NOT_EXPORTED' }).sh,
        fs: fakeFs().fs,
      }),
    ).toThrow('probe failed: ERR_PACKAGE_PATH_NOT_EXPORTED');
  });

  it('removes the scratch directory whether it passed or failed', () => {
    const passing = fakeFs();
    packSmoke({ pkgDir: '/repo', sh: fakeSh().sh, fs: passing.fs });
    expect(passing.removed).toEqual(['/scratch']);

    const failing = fakeFs([]);
    expect(() => packSmoke({ pkgDir: '/repo', sh: fakeSh().sh, fs: failing.fs })).toThrow();
    expect(failing.removed).toEqual(['/scratch']);
  });
});

describe('the real shell and workspace', () => {
  it('runs a command and returns its output', () => {
    expect(shell(process.execPath, ['-e', "process.stdout.write('hi')"], process.cwd())).toBe('hi');
  });

  it('makes, lists, writes to and removes a scratch directory', () => {
    const dir = workspace.make();
    workspace.write(`${dir}/note.txt`, 'contents');
    expect(workspace.list(dir)).toEqual(['note.txt']);
    workspace.remove(dir);
    expect(existsSync(dir)).toBe(false);
  });
});

describe('main', () => {
  const log = vi.spyOn(console, 'log').mockImplementation(() => {});
  const error = vi.spyOn(console, 'error').mockImplementation(() => {});
  afterEach(() => {
    log.mockClear();
    error.mockClear();
  });

  it('prints the success line and exits 0', () => {
    expect(main('/repo', { sh: fakeSh().sh, fs: fakeFs().fs })).toBe(0);
    expect(log).toHaveBeenCalledWith(expect.stringContaining('pack:smoke ok'));
  });

  it('turns a broken package into a readable failure, not a stack trace', () => {
    expect(main('/repo', { sh: fakeSh().sh, fs: fakeFs([]).fs })).toBe(1);
    expect(error).toHaveBeenCalledWith('pack:smoke failed — npm pack produced no tarball');
  });

  it('smokes the current directory when told no other', () => {
    const { fs } = fakeFs();
    const sh = vi.fn(() => '0.1.0\nok') as unknown as Shell;
    main(undefined, { sh, fs });
    expect(sh).toHaveBeenCalledWith('npm', expect.arrayContaining(['pack']), process.cwd());
  });
});
