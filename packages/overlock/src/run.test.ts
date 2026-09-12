import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { run } from './run.js';
import { ledgerPath } from './ledger.js';
import { PASSING_TEST, SKIPPED_TEST, TempRepo } from './__fixtures__/repo.js';

let repo: TempRepo | null = null;

afterEach(() => {
  repo?.cleanup();
  repo = null;
  delete process.env.OVERLOCK_LEDGER;
});

function repoWithWeakenedTest(): TempRepo {
  const r = new TempRepo();
  repo = r;
  r.write('src/auth.test.ts', PASSING_TEST);
  r.commit('feat: add auth tests');
  r.write('src/auth.test.ts', SKIPPED_TEST);
  return r;
}

describe('run', () => {
  it('finds the skip an agent left in the working tree', () => {
    const r = repoWithWeakenedTest();
    const { report, branch } = run({ cwd: r.dir, base: 'auto', ledger: false });

    expect(branch).toBe('main');
    expect(report.ok).toBe(false);
    expect(report.findings.map((f) => f.rule)).toContain('TEST_SKIPPED_ADDED');
  });

  it('records the run in the ledger without recording source', () => {
    const r = repoWithWeakenedTest();
    const path = join(r.dir, 'ledger.jsonl');
    process.env.OVERLOCK_LEDGER = path;

    run({ cwd: r.dir, base: 'auto', mode: 'hook' });

    const entry = JSON.parse(readFileSync(path, 'utf8').trim()) as Record<string, unknown>;
    expect(entry.mode).toBe('hook');
    expect(entry.blocked).toBe(true);
    expect(entry.branch).toBe('main');
    expect(JSON.stringify(entry)).not.toContain('rejects expired tokens');
  });

  it('writes nothing when the ledger is off', () => {
    const r = repoWithWeakenedTest();
    const path = join(r.dir, 'ledger.jsonl');
    process.env.OVERLOCK_LEDGER = path;

    run({ cwd: r.dir, base: 'auto', ledger: false });

    expect(() => readFileSync(path, 'utf8')).toThrow();
  });

  it('honours OVERLOCK_LEDGER for the default path', () => {
    process.env.OVERLOCK_LEDGER = '/tmp/explicit.jsonl';
    expect(ledgerPath(process.env)).toBe('/tmp/explicit.jsonl');
  });
});

describe('excluded paths', () => {
  it('reads neither the findings nor the files of an excluded directory', () => {
    const r = new TempRepo();
    repo = r;
    r.write('src/auth.test.ts', PASSING_TEST);
    r.write('.basting/fixtures/probe.test.ts', PASSING_TEST);
    r.commit('feat: add auth tests');
    // The same weakening in the agent's work and in a sibling tool's evidence.
    r.write('src/auth.test.ts', SKIPPED_TEST);
    r.write('.basting/fixtures/probe.test.ts', SKIPPED_TEST);
    r.write('.basting/runs/s.jsonl', '{}\n');

    const all = run({ cwd: r.dir, base: 'HEAD', ledger: false });
    expect(all.report.findings.map((f) => f.file)).toContain('.basting/fixtures/probe.test.ts');

    const { report } = run({ cwd: r.dir, base: 'HEAD', ledger: false, exclude: ['.basting'] });
    expect(report.findings.map((f) => f.file)).toEqual(['src/auth.test.ts']);
    expect(report.scope).toEqual({ files: 1, commits: 0 });
  });
});

describe('reading Overlock-Allow trailers from a file', () => {
  it('applies what the file says', () => {
    const r = repoWithWeakenedTest();
    const body = join(r.dir, 'pr-body.txt');
    writeFileSync(body, 'Overlock-Allow: TEST_SKIPPED_ADDED -- quarantined pending #412\n', 'utf8');

    const { report } = run({ cwd: r.dir, base: 'auto', ledger: false, allowFile: body });

    expect(report.findings).toEqual([]);
    expect(report.allowed[0]?.reason).toBe('quarantined pending #412');
  });

  /**
   * A missing pull request body must never be the reason a gate stops gating,
   * so an unreadable file is the same as no file.
   */
  it('carries on when the file is not there', () => {
    const r = repoWithWeakenedTest();
    const { report } = run({
      cwd: r.dir,
      base: 'auto',
      ledger: false,
      allowFile: join(r.dir, 'no-such-file.txt'),
    });

    expect(report.findings).not.toEqual([]);
    expect(report.allowed).toEqual([]);
  });
});
