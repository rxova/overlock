import { describe, expect, it } from 'vitest';
import { analyze } from './analyze.js';
import { collectAllowances } from './allow.js';
import { diffOf, hunk } from './__fixtures__/diffs.js';

const skip = diffOf('src/a.test.ts', hunk("+  it.skip('rejects', () => {})"));

describe('collectAllowances', () => {
  it('reads a rule and a reason from a trailer', () => {
    const allowances = collectAllowances(
      [
        'refactor: rename the package',
        '',
        'Overlock-Allow: TEST_REMOVED -- split into six files',
      ].join('\n'),
    );

    expect(allowances).toEqual([
      { rule: 'TEST_REMOVED', target: null, reason: 'split into six files' },
    ]);
  });

  it('reads a path when the trailer names one', () => {
    const [found] = collectAllowances(
      'Overlock-Allow: TEST_REMOVED src/a.test.ts -- gone for good',
    );
    expect(found).toMatchObject({ target: 'src/a.test.ts' });
  });

  it('is case-insensitive about the trailer key, as git is', () => {
    expect(collectAllowances('overlock-allow: TEST_REMOVED -- a reason')).toHaveLength(1);
  });

  it('ignores a trailer with no reason, an unknown rule, or no rule', () => {
    for (const text of [
      'Overlock-Allow: TEST_REMOVED',
      'Overlock-Allow: NOT_A_RULE -- a reason',
      'Overlock-Allow: -- a reason',
    ]) {
      expect(collectAllowances(text)).toEqual([]);
    }
  });
});

describe('a patch-level acknowledgement', () => {
  it('silences its rule across the patch, and is counted', () => {
    const report = analyze({
      diff: skip,
      allowText: 'Overlock-Allow: TEST_SKIPPED_ADDED -- quarantined for the release',
    });

    expect(report.findings).toEqual([]);
    expect(report.suppressed).toBe(1);
    expect(report.allowed).toEqual([
      { rule: 'TEST_SKIPPED_ADDED', target: null, reason: 'quarantined for the release' },
    ]);
    expect(report.ok).toBe(true);
  });

  it('leaves every other rule standing', () => {
    const report = analyze({
      diff: skip,
      allowText: 'Overlock-Allow: TEST_REMOVED -- a different rule',
    });

    expect(report.findings.map((f) => f.rule)).toEqual(['TEST_SKIPPED_ADDED']);
    expect(report.allowed).toEqual([]);
  });

  it('covers only the path it names', () => {
    const elsewhere = analyze({
      diff: skip,
      allowText: 'Overlock-Allow: TEST_SKIPPED_ADDED src/b.test.ts -- another file',
    });
    expect(elsewhere.findings).toHaveLength(1);

    const here = analyze({
      diff: skip,
      allowText: 'Overlock-Allow: TEST_SKIPPED_ADDED src/a.test.ts -- this one',
    });
    expect(here.findings).toEqual([]);
  });

  it('does nothing when there is no trailer text, which is Stop time', () => {
    expect(analyze({ diff: skip }).findings).toHaveLength(1);
    expect(analyze({ diff: skip, allowText: '' }).allowed).toEqual([]);
  });
});
