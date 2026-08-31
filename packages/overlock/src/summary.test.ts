import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CATCH_BAR, meetsBar, readLedger, summarize } from './summary.js';
import { summaryText } from './report.js';
import type { LedgerEntry } from './ledger.js';
import type { Severity } from './types.js';

const NOW = new Date('2026-08-31T00:00:00.000Z');

function entry(overrides: Partial<LedgerEntry> & { hoursAgo?: number } = {}): LedgerEntry {
  const { hoursAgo = 1, ...rest } = overrides;
  const rules = rest.rules ?? [];
  const counts: Record<Severity, number> = { high: 0, medium: 0, low: 0 };
  for (const r of rules) counts[r.severity] += 1;

  return {
    ts: new Date(NOW.getTime() - hoursAgo * 3600_000).toISOString(),
    repo: '/repo',
    branch: 'main',
    base: 'HEAD',
    mode: 'check',
    ok: rules.length === 0,
    blocked: false,
    counts,
    suppressed: 0,
    ...rest,
    rules,
  };
}

const high = [
  { rule: 'TEST_SKIPPED_ADDED', severity: 'high' as const, file: 'a.test.ts', line: 1 },
];
const low = [
  { rule: 'TEST_AND_IMPL_TOGETHER', severity: 'low' as const, file: 'a.test.ts', line: 1 },
];

describe('readLedger', () => {
  it('is empty when there is no file', () => {
    expect(readLedger('/nowhere/ledger.jsonl')).toEqual([]);
  });

  it('skips malformed and truncated lines rather than giving up', () => {
    const dir = mkdtempSync(join(tmpdir(), 'overlock-summary-'));
    const path = join(dir, 'ledger.jsonl');
    writeFileSync(
      path,
      [JSON.stringify(entry()), 'not json', '', '{"half":', JSON.stringify(entry())].join('\n'),
    );

    try {
      expect(readLedger(path)).toHaveLength(2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('rejects rows that are not ledger entries', () => {
    const dir = mkdtempSync(join(tmpdir(), 'overlock-summary-'));
    const path = join(dir, 'ledger.jsonl');
    writeFileSync(path, ['{"unrelated":true}', '[]', 'null'].join('\n'));

    try {
      expect(readLedger(path)).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('summarize', () => {
  it('counts nothing for an empty ledger', () => {
    const s = summarize([], { days: 30, now: NOW });
    expect(s).toMatchObject({ runs: 0, caught: 0, noted: 0, blocked: 0, repos: 0 });
    expect(s.first).toBeNull();
  });

  // The metric that decides whether the tool passes its own bar, so it is the
  // one most worth pinning: low findings are context, not catches.
  it('does not count a low-only run as a catch', () => {
    const s = summarize([entry({ rules: low })], { now: NOW });
    expect(s.caught).toBe(0);
    expect(s.noted).toBe(1);
  });

  it('counts a run carrying anything above low', () => {
    const s = summarize([entry({ rules: high }), entry({ rules: [...high, ...low] })], {
      now: NOW,
    });
    expect(s.caught).toBe(2);
    expect(s.noted).toBe(0);
  });

  it('counts a run once however many rules fired', () => {
    const s = summarize([entry({ rules: [...high, ...high] })], { now: NOW });
    expect(s.caught).toBe(1);
    expect(s.byRule[0]?.count).toBe(2);
  });

  it('honours the day window', () => {
    const entries = [
      entry({ hoursAgo: 1, rules: high }),
      entry({ hoursAgo: 24 * 40, rules: high }),
    ];

    expect(summarize(entries, { days: 30, now: NOW }).caught).toBe(1);
    expect(summarize(entries, { now: NOW }).caught).toBe(2);
  });

  it('ignores an unparseable timestamp when a window is set', () => {
    const s = summarize([entry({ ts: 'not a date', rules: high })], { days: 30, now: NOW });
    expect(s.runs).toBe(0);
  });

  it('tallies blocks, suppressions and repositories', () => {
    const s = summarize(
      [
        entry({ repo: '/a', rules: high, blocked: true, suppressed: 2 }),
        entry({ repo: '/b', rules: high }),
        entry({ repo: '/b' }),
      ],
      { now: NOW },
    );

    expect(s).toMatchObject({ runs: 3, blocked: 1, suppressed: 2, repos: 2 });
    expect(s.byRepo).toEqual([
      { repo: '/a', caught: 1 },
      { repo: '/b', caught: 1 },
    ]);
  });

  it('orders rules by frequency', () => {
    const s = summarize([entry({ rules: [...high, ...high] }), entry({ rules: low })], {
      now: NOW,
    });
    expect(s.byRule.map((r) => r.rule)).toEqual(['TEST_SKIPPED_ADDED', 'TEST_AND_IMPL_TOGETHER']);
  });

  it('survives a row written before `suppressed` existed', () => {
    const legacy = { ...entry({ rules: high }) } as Partial<LedgerEntry>;
    delete legacy.suppressed;
    delete legacy.rules;

    const s = summarize([legacy as LedgerEntry], { now: NOW });
    expect(s).toMatchObject({ runs: 1, caught: 0, suppressed: 0 });
  });
});

describe('meetsBar', () => {
  it('needs the pre-registered number of catches', () => {
    const under = summarize(
      Array.from({ length: CATCH_BAR - 1 }, () => entry({ rules: high })),
      {
        now: NOW,
      },
    );
    const over = summarize(
      Array.from({ length: CATCH_BAR }, () => entry({ rules: high })),
      {
        now: NOW,
      },
    );

    expect(meetsBar(under)).toBe(false);
    expect(meetsBar(over)).toBe(true);
  });

  it('cannot be met by low findings alone', () => {
    const s = summarize(
      Array.from({ length: 50 }, () => entry({ rules: low })),
      { now: NOW },
    );
    expect(meetsBar(s)).toBe(false);
  });
});

describe('summaryText', () => {
  it('tells you how to start when nothing is recorded', () => {
    const text = summaryText(summarize([], { days: 30, now: NOW }), false);
    expect(text).toContain('nothing recorded');
    expect(text).toContain('overlock init claude');
  });

  it('separates low-severity rules from the headline chart', () => {
    const s = summarize([entry({ rules: high }), entry({ rules: low })], { now: NOW });
    const text = summaryText(s, false);

    expect(text).toContain('By rule');
    expect(text).toContain('Context only');
    expect(text.indexOf('TEST_SKIPPED_ADDED')).toBeLessThan(text.indexOf('Context only'));
    expect(text.indexOf('TEST_AND_IMPL_TOGETHER')).toBeGreaterThan(text.indexOf('Context only'));
  });

  it('states whether the bar was met, and what it cannot judge', () => {
    const met = summaryText(
      summarize(
        Array.from({ length: CATCH_BAR }, () => entry({ rules: high })),
        { now: NOW },
      ),
      false,
    );
    expect(met).toContain('met.');
    expect(met).toContain('only you can answer');

    const missed = summaryText(summarize([entry({ rules: high })], { now: NOW }), false);
    expect(missed).toContain('not met yet');
  });

  it('breaks down by repository once there is more than one', () => {
    const s = summarize([entry({ repo: '/a', rules: high }), entry({ repo: '/b', rules: high })], {
      now: NOW,
    });
    const text = summaryText(s, false);

    expect(text).toContain('By repository');
    expect(text).toContain('/a');
    expect(text).toContain('/b');
  });

  it('keeps the identifying tail of a long repository path', () => {
    const long = `/home/someone/a/very/deeply/nested/workspace/directory/${'x'.repeat(40)}/my-repo`;
    const s = summarize([entry({ repo: long, rules: high }), entry({ repo: '/b', rules: high })], {
      now: NOW,
    });
    const text = summaryText(s, false);

    expect(text).toContain('my-repo');
    expect(text).toContain('...');
    expect(text.split('\n').every((l) => l.length < 100)).toBe(true);
  });

  it('hides the per-repository breakdown for a single repository', () => {
    expect(summaryText(summarize([entry({ rules: high })], { now: NOW }), false)).not.toContain(
      'By repository',
    );
  });
});
