/**
 * The point of this file is that a declared policy is either obeyed or
 * refused — never half-read. A setting that silently does nothing is the
 * failure the config file exists to remove, so most of these cases are about
 * what has to be an error.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { applyConfig, parseArgs } from './cli.js';
import { CONFIG_FILE, ConfigError, loadConfig, parseConfig } from './config.js';

let dir: string | null = null;

function tree(files: Record<string, string>): string {
  dir = mkdtempSync(join(tmpdir(), 'overlock-config-'));
  for (const [relative, contents] of Object.entries(files)) {
    const file = join(dir, relative);
    mkdirSync(join(file, '..'), { recursive: true });
    writeFileSync(file, contents, 'utf8');
  }
  return dir;
}

afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = null;
});

const json = (value: unknown): string => JSON.stringify(value);

describe('parseConfig', () => {
  it('accepts everything it knows', () => {
    const config = parseConfig(
      {
        base: 'origin/main',
        baseMode: 'direct',
        failOn: 'medium',
        failOnEmpty: true,
        severity: { TEST_REMOVED: 'medium' },
        testGlob: ['\\.check\\.ts$'],
        untracked: false,
      },
      'test',
    );

    expect(config).toEqual({
      base: 'origin/main',
      baseMode: 'direct',
      failOn: 'medium',
      failOnEmpty: true,
      severity: { TEST_REMOVED: 'medium' },
      testGlob: ['\\.check\\.ts$'],
      untracked: false,
    });
  });

  it('accepts an empty object', () => {
    expect(parseConfig({}, 'test')).toEqual({});
  });

  it('refuses a setting it does not know, and says what it does know', () => {
    expect(() => parseConfig({ failon: 'high' }, 'test')).toThrow(
      /unknown setting "failon".*Known: base, baseMode, failOn/s,
    );
  });

  it.each([
    ['not an object', 'a string'],
    ['a base that is not a ref', { base: 42 }],
    ['an empty base', { base: '' }],
    ['a base mode it does not have', { baseMode: 'sideways' }],
    ['a level it does not have', { failOn: 'catastrophic' }],
    ['a non-boolean failOnEmpty', { failOnEmpty: 'yes' }],
    ['a non-boolean untracked', { untracked: 'no' }],
    ['severity that is not a map', { severity: ['TEST_REMOVED'] }],
    ['severity naming a rule that does not exist', { severity: { TEST_GONE: 'low' } }],
    ['severity with a level that does not exist', { severity: { TEST_REMOVED: 'urgent' } }],
    ['severity graded none, which is not a grade', { severity: { TEST_REMOVED: 'none' } }],
    ['testGlob that is not an array', { testGlob: '\\.check\\.ts$' }],
    ['testGlob holding something other than strings', { testGlob: [42] }],
    ['testGlob holding a regex that does not compile', { testGlob: ['('] }],
  ])('refuses %s', (_case, value) => {
    expect(() => parseConfig(value, 'test')).toThrow(ConfigError);
  });

  it('names the file in the message', () => {
    expect(() => parseConfig({ failOn: 'nope' }, '/repo/overlock.config.json')).toThrow(
      /^\/repo\/overlock\.config\.json:/,
    );
  });
});

describe('loadConfig', () => {
  it('finds nothing when there is nothing to find', () => {
    const root = tree({ 'a.txt': 'hello\n' });
    expect(loadConfig({ cwd: root })).toEqual({ config: {}, path: null });
  });

  it('reads the file beside the caller', () => {
    const root = tree({ [CONFIG_FILE]: json({ failOn: 'low' }) });
    const loaded = loadConfig({ cwd: root });
    expect(loaded.config).toEqual({ failOn: 'low' });
    expect(loaded.path).toBe(join(root, CONFIG_FILE));
  });

  it('walks up to find one', () => {
    const root = tree({
      [CONFIG_FILE]: json({ failOn: 'low' }),
      'packages/app/src/index.ts': '',
    });
    expect(loadConfig({ cwd: join(root, 'packages/app/src') }).config).toEqual({ failOn: 'low' });
  });

  it('lets a nested package have its own answer', () => {
    const root = tree({
      [CONFIG_FILE]: json({ failOn: 'low' }),
      [join('packages/app', CONFIG_FILE)]: json({ failOn: 'high' }),
    });
    expect(loadConfig({ cwd: join(root, 'packages/app') }).config).toEqual({ failOn: 'high' });
  });

  it('reads the overlock key of a package.json', () => {
    const root = tree({
      'package.json': json({ name: 'app', overlock: { base: 'origin/main' } }),
    });
    const loaded = loadConfig({ cwd: root });
    expect(loaded.config).toEqual({ base: 'origin/main' });
    expect(loaded.path).toBe(join(root, 'package.json'));
  });

  it('prefers the config file over a package.json beside it', () => {
    const root = tree({
      [CONFIG_FILE]: json({ failOn: 'low' }),
      'package.json': json({ overlock: { failOn: 'high' } }),
    });
    expect(loadConfig({ cwd: root }).config).toEqual({ failOn: 'low' });
  });

  it('does not let a package.json without the key stop the walk', () => {
    const root = tree({
      [CONFIG_FILE]: json({ failOn: 'low' }),
      'packages/app/package.json': json({ name: 'app' }),
    });
    expect(loadConfig({ cwd: join(root, 'packages/app') }).config).toEqual({ failOn: 'low' });
  });

  it('reads the file it is pointed at', () => {
    const root = tree({ 'ci/overlock.json': json({ failOn: 'none' }) });
    expect(loadConfig({ cwd: root, path: 'ci/overlock.json' }).config).toEqual({ failOn: 'none' });
    expect(loadConfig({ cwd: root, path: join(root, 'ci/overlock.json') }).config).toEqual({
      failOn: 'none',
    });
  });

  it('fails on a file it was pointed at and cannot read', () => {
    const root = tree({ 'a.txt': '' });
    expect(() => loadConfig({ cwd: root, path: 'nope.json' })).toThrow(ConfigError);
  });

  it('fails on a file that is not JSON, rather than carrying on without it', () => {
    const root = tree({ [CONFIG_FILE]: '{ oops' });
    expect(() => loadConfig({ cwd: root })).toThrow(/not valid JSON/);
  });

  it('fails on a package.json overlock key that is malformed', () => {
    const root = tree({ 'package.json': json({ overlock: { failOn: 'nope' } }) });
    expect(() => loadConfig({ cwd: root })).toThrow(/package\.json \(overlock\)/);
  });
});

describe('applyConfig', () => {
  const args = (argv: string[]) => parseArgs(argv, '/repo');

  it('fills in what the caller did not say', () => {
    const applied = applyConfig(args([]), {
      base: 'origin/main',
      baseMode: 'direct',
      failOn: 'low',
      failOnEmpty: true,
      untracked: false,
      severity: { TEST_REMOVED: 'medium' },
      testGlob: ['\\.check\\.ts$'],
    });

    expect(applied.base).toBe('origin/main');
    expect(applied.baseMode).toBe('direct');
    expect(applied.failOn).toBe('low');
    expect(applied.failOnEmpty).toBe(true);
    expect(applied.untracked).toBe(false);
    expect(applied.severities).toEqual({ TEST_REMOVED: 'medium' });
    expect(applied.testGlobs.map((r) => r.source)).toEqual(['\\.check\\.ts$']);
  });

  it('leaves alone anything the caller did say', () => {
    const applied = applyConfig(
      args(['--base', 'HEAD~3', '--base-mode', 'direct', '--fail-on', 'none']),
      { base: 'origin/main', baseMode: 'fork-point', failOn: 'low' },
    );

    expect(applied.base).toBe('HEAD~3');
    expect(applied.baseMode).toBe('direct');
    expect(applied.failOn).toBe('none');
  });

  it('treats a --no- flag as a decision too', () => {
    expect(applyConfig(args(['--no-untracked']), { untracked: true }).untracked).toBe(false);
  });

  it('replaces the repeatable lists rather than merging them', () => {
    // A caller passing one --severity means that list. Adding the file's
    // entries to it would produce a policy written down in neither place.
    const applied = applyConfig(args(['--severity', 'TEST_SKIPPED_ADDED=low']), {
      severity: { TEST_REMOVED: 'medium' },
    });
    expect(applied.severities).toEqual({ TEST_SKIPPED_ADDED: 'low' });

    const globs = applyConfig(args(['--test-glob', 'a$']), { testGlob: ['b$'] });
    expect(globs.testGlobs.map((r) => r.source)).toEqual(['a$']);
  });

  it('changes nothing when the file declares nothing', () => {
    const applied = applyConfig(args([]), {});
    expect(applied.base).toBeUndefined();
    expect(applied.failOn).toBe('high');
    expect(applied.severities).toEqual({});
  });
});
