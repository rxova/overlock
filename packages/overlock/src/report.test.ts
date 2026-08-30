import { describe, expect, it } from 'vitest';
import { analyze } from './analyze.js';
import { compact, human, json, useColor } from './report.js';
import { diffOf, hunk } from './__fixtures__/diffs.js';

const ESC = '\u001B[';

const clean = analyze({ diff: '' });
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

  it('emits escape codes only when colour is on', () => {
    expect(human(dirty, false)).not.toContain(ESC);
    expect(human(dirty, true)).toContain(ESC);
  });
});

describe('compact', () => {
  it('is one line when clean', () => {
    expect(compact(clean)).toBe('overlock: clean.');
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
