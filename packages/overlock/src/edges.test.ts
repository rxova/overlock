import { describe, expect, it } from 'vitest';
import { analyze } from './analyze.js';
import { compact, human } from './report.js';
import { sourceSubject, testSubject } from './paths.js';
import { diffOf, hunk } from './__fixtures__/diffs.js';

/**
 * The awkward corners: cases that are rare in a repository but routine in a
 * patch written by something that is optimising for a green check. Each one is
 * a behaviour worth pinning, not a line worth colouring in.
 */

describe('ordering', () => {
  it('breaks a tie between two findings of the same rule by path then line', () => {
    const diff =
      diffOf('src/z.test.ts', hunk("+  it.skip('later', () => {})")) +
      diffOf('src/a.test.ts', hunk("+  it.skip('earlier', () => {})"));

    const files = analyze({ diff }).findings.map((f) => f.file);
    expect(files).toEqual(['src/a.test.ts', 'src/z.test.ts']);
  });

  it('orders two findings in one file by line number', () => {
    const diff = diffOf(
      'src/a.test.ts',
      hunk(
        ["+  it.skip('one', () => {})", '+  const x = 1;', "+  it.skip('two', () => {})"].join(
          '\n',
        ),
      ),
    );

    const lines = analyze({ diff }).findings.map((f) => f.line ?? 0);
    expect(lines).toEqual([...lines].sort((a, b) => a - b));
    expect(lines.length).toBe(2);
  });
});

describe('evidence with only a before side', () => {
  const removal = analyze({ diff: diffOf('src/a.test.ts', hunk("-  it('rejects', () => {})")) });

  it('renders as a removal in the terminal view', () => {
    const text = human(removal, false);
    expect(text).toContain('- it(');
    expect(text).not.toContain('+ it(');
  });

  it('renders with a minus prefix in the phone view', () => {
    expect(compact(removal)).toContain('- it(');
  });
});

describe('summaries', () => {
  it('names only the severities that occurred', () => {
    const mediumOnly = analyze({
      diff: diffOf('src/a.test.ts', hunk(['-  expect(a).toBe(1);', '+  noop();'].join('\n'))),
    });

    expect(mediumOnly.counts).toMatchObject({ high: 0, low: 0 });
    expect(compact(mediumOnly)).toContain('medium');
    expect(compact(mediumOnly)).not.toContain('high');
  });

  it('says "finding" rather than "findings" for exactly one', () => {
    const single = analyze({ diff: diffOf('src/a.test.ts', hunk("+  it.skip('x', () => {})")) });
    expect(compact(single)).toContain('1 finding (');
  });
});

describe('assertion pairing corners', () => {
  it('ignores a weakened matcher when neither line names a subject', () => {
    const diff = diffOf(
      'src/a.test.ts',
      hunk(['-  assertEqual(1, 2);', '+  assertTrue(thing);'].join('\n')),
    );
    expect(analyze({ diff }).findings.map((f) => f.rule)).not.toContain('ASSERTION_WEAKENED');
  });

  it('does not reuse one added line to excuse two removals', () => {
    const diff = diffOf(
      'src/a.test.ts',
      hunk(['-  expect(a).toBe(1);', '-  expect(b).toBe(1);', '+  expect(a).toBe(2);'].join('\n')),
    );

    const changed = analyze({ diff }).findings.filter((f) => f.rule === 'EXPECTED_VALUE_CHANGED');
    expect(changed).toHaveLength(1);
  });

  it('still reports lost assertions when none of the removed lines is recognisable', () => {
    // Assertions counted inside a removed multi-line chain: the count drops even
    // though no single removed line is itself an assertion call.
    const diff = diffOf(
      'src/a.test.ts',
      hunk(['-    .expect(200)', '-  expect(res.body).toEqual({ ok: true });'].join('\n')),
    );

    const found = analyze({ diff }).findings.find((f) => f.rule === 'ASSERTION_REMOVED');
    expect(found?.severity).toBe('medium');
  });
});

describe('subjects', () => {
  it('has no subject for a path with no basename', () => {
    expect(testSubject('')).toBeNull();
  });

  it('lowercases a source stem with no extension', () => {
    expect(sourceSubject('Makefile')).toBe('makefile');
  });
});

describe('production-file filtering', () => {
  it('does not pair a test with a changed markdown or config file', () => {
    const diff =
      diffOf('src/login.test.ts', hunk('+  expect(login()).toBe(1);')) +
      diffOf('login.md', hunk('+docs')) +
      diffOf('login.config.ts', hunk('+export default {};'));

    expect(analyze({ diff }).findings.map((f) => f.rule)).not.toContain('TEST_AND_IMPL_TOGETHER');
  });

  it('does not flag a snapshot when nothing but tests changed with it', () => {
    const diff =
      diffOf('src/__snapshots__/a.test.ts.snap', hunk('+exports[`x`] = `1`;')) +
      diffOf('src/a.test.ts', hunk('+  expect(1).toBe(1);'));

    expect(analyze({ diff }).findings.map((f) => f.rule)).not.toContain(
      'SNAPSHOT_UPDATED_WITH_CODE',
    );
  });
});
