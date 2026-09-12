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

  it('reads a quoted target, because a case title has spaces in it', () => {
    const [found] = collectAllowances(
      'Overlock-Allow: TEST_REMOVED "src/a.test.ts::rejects expired tokens" -- ported to b',
    );
    expect(found).toMatchObject({ target: 'src/a.test.ts::rejects expired tokens' });
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

describe('a trailer with whitespace around its reason', () => {
  it('drops the trailing whitespace from the reason', () => {
    expect(collectAllowances('Overlock-Allow: TEST_REMOVED -- split \t  ')).toEqual([
      { rule: 'TEST_REMOVED', target: null, reason: 'split' },
    ]);
  });

  it('reads a trailer from a CRLF body, which is how GitHub returns one', () => {
    expect(collectAllowances('fix: x\r\n\r\nOverlock-Allow: TEST_REMOVED -- split\r\n')).toEqual([
      { rule: 'TEST_REMOVED', target: null, reason: 'split' },
    ]);
  });

  it('reads a long run of spaces inside the reason in linear time', () => {
    const reason = `a${' '.repeat(100_000)}b`;
    const [allowance] = collectAllowances(`Overlock-Allow: TEST_REMOVED -- ${reason}`);
    expect(allowance?.reason.startsWith('a  ')).toBe(true);
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

/**
 * A file where fifteen cases were ported and two were not is one file and
 * seventeen findings. A directive that can only name the file cannot say which
 * two are the ones nobody has explained.
 */
describe('an acknowledgement narrower than a file', () => {
  const removed = diffOf(
    'src/a.test.ts',
    hunk(
      [
        " it('kept', () => {})",
        "-  it('ported to b', () => {})",
        "-  it('nobody has explained this one', () => {})",
      ].join('\n'),
    ),
  );

  it('covers the case it names and leaves the rest standing', () => {
    const report = analyze({
      diff: removed,
      allowText: 'Overlock-Allow: TEST_REMOVED "src/a.test.ts::ported to b" -- moved to b.test.ts',
    });

    expect(report.findings.map((f) => f.subject)).toEqual(['nobody has explained this one']);
    expect(report.suppressed).toBe(1);
  });

  it('covers one line when it names a line, as the report prints it', () => {
    const line = analyze({ diff: removed }).findings[0]?.line;
    const report = analyze({
      diff: removed,
      allowText: `Overlock-Allow: TEST_REMOVED src/a.test.ts:${line} -- moved to b.test.ts`,
    });

    expect(report.findings).toHaveLength(1);
  });

  it('still covers the whole file when it names the file', () => {
    const report = analyze({
      diff: removed,
      allowText: 'Overlock-Allow: TEST_REMOVED src/a.test.ts -- the whole file moved',
    });
    expect(report.findings).toEqual([]);
  });
});

/**
 * An acknowledgement is a claim about a finding. When the finding is not there,
 * the claim has outlived whatever it was written for — and the one thing a
 * reviewer must not conclude from a clean run is that every line of it still holds.
 */
describe('an acknowledgement that silenced nothing', () => {
  it('is reported rather than quietly doing nothing', () => {
    const report = analyze({
      diff: skip,
      allowText: [
        'Overlock-Allow: TEST_SKIPPED_ADDED -- quarantined for the release',
        'Overlock-Allow: TEST_REMOVED "src/a.test.ts::a case that never landed" -- ported',
      ].join('\n'),
    });

    expect(report.allowed).toHaveLength(1);
    expect(report.allowances_unused).toEqual([
      {
        rule: 'TEST_REMOVED',
        target: 'src/a.test.ts::a case that never landed',
        reason: 'ported',
      },
    ]);
  });

  it('says so on a run with nothing else to report', () => {
    const report = analyze({
      diff: diffOf('src/a.test.ts', hunk('+  const x = 1;')),
      allowText: 'Overlock-Allow: TEST_REMOVED -- ported every case',
    });

    expect(report.ok).toBe(true);
    expect(report.allowances_unused).toHaveLength(1);
  });
});
