import { describe, expect, it } from 'vitest';
import { analyze } from './analyze.js';
import { parseDiff } from './diff.js';
import { applySuppressions, collectSuppressions } from './suppress.js';
import { diffOf, hunk } from './__fixtures__/diffs.js';

const skipLine = "+  it.skip('rejects expired tokens', () => {})";

function withComment(comment: string): string {
  return diffOf('src/a.test.ts', hunk([`+  ${comment}`, skipLine].join('\n')));
}

describe('collectSuppressions', () => {
  it('reads a rule and a reason', () => {
    const files = parseDiff(
      withComment('// overlock-ignore TEST_SKIPPED_ADDED -- flaky, see #412'),
    );
    const [found] = collectSuppressions(files);

    expect(found).toMatchObject({
      rule: 'TEST_SKIPPED_ADDED',
      reason: 'flaky, see #412',
      file: 'src/a.test.ts',
    });
  });

  it('accepts any comment syntax, since the directive is what matters', () => {
    for (const comment of [
      '// overlock-ignore TEST_SKIPPED_ADDED -- a reason',
      '# overlock-ignore TEST_SKIPPED_ADDED -- a reason',
      '/* overlock-ignore TEST_SKIPPED_ADDED -- a reason */',
    ]) {
      expect(collectSuppressions(parseDiff(withComment(comment)))).toHaveLength(1);
    }
  });

  it('ignores a directive with no reason', () => {
    expect(
      collectSuppressions(parseDiff(withComment('// overlock-ignore TEST_SKIPPED_ADDED'))),
    ).toEqual([]);
    expect(
      collectSuppressions(parseDiff(withComment('// overlock-ignore TEST_SKIPPED_ADDED --'))),
    ).toEqual([]);
    expect(
      collectSuppressions(parseDiff(withComment('// overlock-ignore TEST_SKIPPED_ADDED --    '))),
    ).toEqual([]);
  });

  it('ignores a rule ID that does not exist', () => {
    expect(
      collectSuppressions(parseDiff(withComment('// overlock-ignore NOT_A_RULE -- a reason'))),
    ).toEqual([]);
  });

  it('has no wildcard', () => {
    expect(
      collectSuppressions(parseDiff(withComment('// overlock-ignore * -- silence everything'))),
    ).toEqual([]);
  });

  it('counts a directive that survives in context, not one being removed', () => {
    const context = diffOf(
      'src/a.test.ts',
      hunk([' // overlock-ignore TEST_SKIPPED_ADDED -- kept', skipLine].join('\n')),
    );
    expect(collectSuppressions(parseDiff(context))).toHaveLength(1);

    const removed = diffOf(
      'src/a.test.ts',
      hunk(['-// overlock-ignore TEST_SKIPPED_ADDED -- deleted', skipLine].join('\n')),
    );
    expect(collectSuppressions(parseDiff(removed))).toEqual([]);
  });
});

describe('applySuppressions', () => {
  it('returns everything untouched when there is nothing to apply', () => {
    const findings = analyze({ diff: diffOf('src/a.test.ts', hunk(skipLine)) }).findings;
    expect(applySuppressions(findings, [])).toEqual({ kept: findings, suppressed: [] });
  });
});

describe('through analyze', () => {
  const bare = diffOf('src/a.test.ts', hunk(skipLine));

  it('silences the finding on the following line', () => {
    const report = analyze({
      diff: withComment('// overlock-ignore TEST_SKIPPED_ADDED -- quarantined, see #412'),
    });

    expect(report.findings).toEqual([]);
    expect(report.suppressed).toBe(1);
    expect(report.ok).toBe(true);
  });

  it('silences a finding on its own line', () => {
    const report = analyze({
      diff: diffOf(
        'src/a.test.ts',
        hunk("+  it.skip('x', () => {}) // overlock-ignore TEST_SKIPPED_ADDED -- see #412"),
      ),
    });

    expect(report.findings).toEqual([]);
    expect(report.suppressed).toBe(1);
  });

  it('does not reach a third line', () => {
    const report = analyze({
      diff: diffOf(
        'src/a.test.ts',
        hunk(
          [
            '+  // overlock-ignore TEST_SKIPPED_ADDED -- only covers the next line',
            '+  const unrelated = 1;',
            skipLine,
          ].join('\n'),
        ),
      ),
    });

    expect(report.findings).toHaveLength(1);
    expect(report.suppressed).toBe(0);
  });

  it('does not silence a different rule at the same place', () => {
    const report = analyze({
      diff: withComment('// overlock-ignore ASSERTION_REMOVED -- wrong rule for this line'),
    });

    expect(report.findings).toHaveLength(1);
    expect(report.suppressed).toBe(0);
    expect(report.ok).toBe(false);
  });

  it('does not silence the same rule in another file', () => {
    const elsewhere =
      diffOf('src/b.test.ts', hunk('+  // overlock-ignore TEST_SKIPPED_ADDED -- other file')) +
      bare;

    expect(analyze({ diff: elsewhere }).findings).toHaveLength(1);
  });

  it('reports zero suppressions when none were used', () => {
    expect(analyze({ diff: bare }).suppressed).toBe(0);
    expect(analyze({ diff: '' }).suppressed).toBe(0);
  });
});
