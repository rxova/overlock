import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { analyze } from './analyze.js';
import { appendLedger, ledgerPath, toEntry } from './ledger.js';
import { diffOf, hunk } from './__fixtures__/diffs.js';

const report = analyze({
  diff: diffOf('src/a.test.ts', hunk("+  it.skip('rejects expired tokens', () => {})")),
});

describe('ledgerPath', () => {
  it('prefers an explicit override', () => {
    expect(ledgerPath({ OVERLOCK_LEDGER: '/x/y.jsonl' })).toBe('/x/y.jsonl');
  });

  it('otherwise sits under the overlock home', () => {
    expect(ledgerPath({ OVERLOCK_HOME: '/home/me/.overlock' })).toBe(
      '/home/me/.overlock/ledger.jsonl',
    );
  });

  it('falls back to the user home directory', () => {
    expect(ledgerPath({})).toMatch(/\.overlock\/ledger\.jsonl$/);
  });
});

describe('toEntry', () => {
  it('keeps rule, severity and location but never source', () => {
    const entry = toEntry({
      report,
      repo: '/repo',
      branch: 'feature',
      mode: 'hook',
      blocked: true,
      now: new Date('2026-08-30T00:00:00.000Z'),
    });

    expect(entry.ts).toBe('2026-08-30T00:00:00.000Z');
    expect(entry.rules[0]).toMatchObject({ rule: 'TEST_SKIPPED_ADDED', severity: 'high' });
    expect(JSON.stringify(entry)).not.toContain('rejects expired tokens');
  });
});

describe('appendLedger', () => {
  it('appends one JSON object per line', () => {
    const dir = mkdtempSync(join(tmpdir(), 'overlock-ledger-'));
    const path = join(dir, 'nested', 'ledger.jsonl');
    const entry = toEntry({ report, repo: '/repo', branch: 'main', mode: 'check', blocked: false });

    try {
      expect(appendLedger(entry, path)).toBe(true);
      expect(appendLedger(entry, path)).toBe(true);

      const lines = readFileSync(path, 'utf8').trim().split('\n');
      expect(lines).toHaveLength(2);
      expect(JSON.parse(lines[0] as string)).toMatchObject({ branch: 'main' });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('reports failure instead of throwing — evidence must never break the gate', () => {
    const dir = mkdtempSync(join(tmpdir(), 'overlock-ledger-'));
    // A file where a directory would have to be: mkdir fails with ENOTDIR
    // immediately, which is the cheapest way to prove the write is guarded.
    const blocker = join(dir, 'blocker');
    writeFileSync(blocker, 'not a directory');
    const entry = toEntry({ report, repo: '/repo', branch: 'main', mode: 'check', blocked: false });

    try {
      expect(appendLedger(entry, join(blocker, 'ledger.jsonl'))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
