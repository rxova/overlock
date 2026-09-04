import { describe, expect, it } from 'vitest';
import { analyze } from './analyze.js';
import { compact, describeScope, human, isEmptyPatch, json, useColor } from './report.js';
import { diffOf, hunk } from './__fixtures__/diffs.js';

const ESC = '\u001B[';

const clean = analyze({ diff: '' });
/** What `run` produces: the same report, plus what the range actually held. */
const withScope = (report: typeof clean, files: number, commits: number) => ({
  ...report,
  scope: { files, commits },
});
const dirty = analyze({
  diff:
    diffOf('src/a.test.ts', hunk("+  it.skip('rejects expired tokens', () => {})")) +
    diffOf('vitest.config.ts', hunk(['-  statements: 95,', '+  statements: 40,'].join('\n'))) +
    diffOf('src/b.test.ts', hunk(['-  expect(a).toBe(1);', '+  expect(a).toBe(2);'].join('\n'))) +
    diffOf('src/c.test.ts', hunk('+  timeout: 9000,')),
});

describe('human', () => {
  it('says so plainly when there is nothing to report', () => {
    expect(human(clean, false)).toContain('nothing weakened');
  });

  it('lists every finding with its evidence and hint', () => {
    const text = human(dirty, false);
    expect(text).toContain('TEST_SKIPPED_ADDED');
    expect(text).toContain('src/a.test.ts');
    expect(text).toContain('rejects expired tokens');
    expect(text).toContain('->');
  });

  it('says what it examined, so a clean run is not the same line as an empty one', () => {
    const text = human(withScope(clean, 83, 3), false);
    expect(text).toContain('nothing weakened');
    expect(text).toContain('83 files, 3 commits, against HEAD');
  });

  it('warns instead of passing when the resolved patch is empty', () => {
    const text = human(withScope(clean, 0, 0), false);
    expect(text).toContain('nothing to examine');
    expect(text).not.toContain('nothing weakened');
  });

  it('reports the scope alongside findings too', () => {
    expect(human(withScope(dirty, 4, 1), false)).toContain('4 files, 1 commit, against HEAD');
  });

  it('emits escape codes only when colour is on', () => {
    expect(human(dirty, false)).not.toContain(ESC);
    expect(human(dirty, true)).toContain(ESC);
  });
});

describe('compact', () => {
  it('is one line when clean, and says what it read', () => {
    expect(compact(withScope(clean, 83, 3))).toBe(
      'overlock: clean — 83 files, 3 commits, against HEAD.',
    );
  });

  it('does not call an empty patch clean', () => {
    expect(compact(withScope(clean, 0, 0))).toContain('nothing to examine');
  });

  it('shows at most the limit and says how many it held back', () => {
    const text = compact(dirty, 2);
    expect(text).toContain('and 2 more');
    expect(text.split('\n').filter((l) => l.startsWith('✗') || l.startsWith('!'))).toHaveLength(2);
  });

  it('leads with the summary line', () => {
    expect(compact(dirty).split('\n')[0]).toContain('4 findings');
  });

  it('clips long evidence so a phone line does not wrap forever', () => {
    const long = analyze({
      diff: diffOf('src/a.test.ts', hunk(`+  it.skip('${'x'.repeat(300)}', () => {})`)),
    });
    const evidence = compact(long)
      .split('\n')
      .find((l) => l.trimStart().startsWith('+'));
    expect(evidence?.length).toBeLessThan(120);
    expect(evidence).toContain('...');
  });

  it('never emits escape codes — it is read through another program', () => {
    expect(compact(dirty)).not.toContain(ESC);
  });
});

describe('the suppressed note', () => {
  it('is absent when nothing was suppressed', () => {
    expect(human(dirty, false)).not.toContain('suppressed');
    expect(compact(dirty)).not.toContain('suppressed');
  });

  it('appears alongside findings, not only on a clean run', () => {
    const withBoth = { ...dirty, suppressed: 2 };
    expect(human(withBoth, false)).toContain('(2 suppressed)');
    expect(compact(withBoth)).toContain('(2 suppressed)');
  });
});

describe('json', () => {
  it('round-trips the report', () => {
    const parsed = JSON.parse(json(dirty)) as typeof dirty;
    expect(parsed.schema).toBe(1);
    expect(parsed.findings).toHaveLength(dirty.findings.length);
    expect(parsed.findings[0]).toHaveProperty('fix_hint');
  });

  it('keeps evidence untruncated where compact clipped it', () => {
    const long = analyze({
      diff: diffOf('src/a.test.ts', hunk(`+  it.skip('${'x'.repeat(300)}', () => {})`)),
    });
    const parsed = JSON.parse(json(long)) as typeof long;
    expect(parsed.findings[0]?.evidence.after?.length).toBeGreaterThan(200);
  });
});

describe('useColor', () => {
  it('follows NO_COLOR over everything else', () => {
    expect(useColor({ isTTY: true }, { NO_COLOR: '1' })).toBe(false);
  });

  it('honours FORCE_COLOR without a TTY', () => {
    expect(useColor({ isTTY: false }, { FORCE_COLOR: '1' })).toBe(true);
  });

  it('otherwise follows the TTY', () => {
    expect(useColor({ isTTY: true }, {})).toBe(true);
    expect(useColor({ isTTY: false }, {})).toBe(false);
    expect(useColor({}, {})).toBe(false);
  });
});

describe('grouping repeated findings', () => {
  /**
   * The same edit in twenty files is one fact. Printing it twenty times is what
   * made a rename unreadable on the phone this output is written for.
   */
  const repeated = ['a', 'b', 'c', 'd', 'e']
    .map((name) => diffOf(`src/${name}.test.ts`, hunk(`+  it.skip('rejects', () => {})`)))
    .join('');

  it('collapses identical findings into one row with a count', () => {
    const text = human(analyze({ diff: repeated }), false);
    const rows = text.split('\n').filter((l) => l.includes('TEST_SKIPPED_ADDED'));

    expect(rows).toHaveLength(1);
    expect(rows[0]).toContain('(5)');
    expect(rows[0]).toContain('and 2 more');
  });

  it('leaves a single finding exactly as it was', () => {
    const one = diffOf('src/a.test.ts', hunk(`+  it.skip('rejects', () => {})`));
    expect(human(analyze({ diff: one }), false)).toContain('src/a.test.ts:1  TEST_SKIPPED_ADDED');
  });
});

describe('a patch the rest of the patch explains', () => {
  const rename = [1, 2, 3]
    .map((n) =>
      diffOf(
        `src/mod${n}.test.ts`,
        hunk(
          [
            `-  it('trainmotherfoca handles ${n}', () => {`,
            `-    expect(trainmotherfoca.run(${n})).toBe(${n});`,
            `+  it('trainmf handles ${n}', () => {`,
            `+    expect(trainmf.run(${n})).toBe(${n});`,
          ].join('\n'),
        ),
      ),
    )
    .join('');

  const report = analyze({ diff: rename });

  it('leads with the rename and the residual', () => {
    const text = human(report, false);
    expect(text).toContain('rename detected  trainmotherfoca -> trainmf');
    expect(text).toContain('0 unexplained');
  });

  it('states what it did not list rather than dropping it silently', () => {
    expect(human(report, false)).toContain('the patch itself accounts for, not listed');
  });

  it('says the same thing in the form a phone can read', () => {
    expect(compact(report)).toContain('trainmotherfoca -> trainmf explains');
  });
});

describe('describeScope', () => {
  it('says the base alone when nothing counted it', () => {
    expect(describeScope(clean)).toBe('against HEAD');
  });

  it('leaves the commit count out when there is none', () => {
    expect(describeScope(withScope(clean, 1, 0))).toBe('1 file, against HEAD');
  });

  it('reads the empty tree and the index by name', () => {
    expect(describeScope({ ...clean, base: '--cached' })).toBe('against staged');
    expect(describeScope({ ...clean, base: '4b825dc642cb6eb9a060e54bf8d69288fbee4904' })).toBe(
      'against no commits yet',
    );
  });
});

describe('isEmptyPatch', () => {
  it('is true only when a run counted nothing and found nothing', () => {
    expect(isEmptyPatch(withScope(clean, 0, 0))).toBe(true);
    expect(isEmptyPatch(withScope(clean, 3, 1))).toBe(false);
    expect(isEmptyPatch(withScope(dirty, 0, 0))).toBe(false);
    // A report from `analyze` alone was never counted, so it cannot be empty.
    expect(isEmptyPatch(clean)).toBe(false);
  });
});
