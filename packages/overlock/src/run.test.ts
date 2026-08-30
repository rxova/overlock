import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
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
