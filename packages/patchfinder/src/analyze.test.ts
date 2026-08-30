import { describe, expect, it } from 'vitest';
import { analyze } from './analyze.js';
import { diffOf, hunk } from './__fixtures__/diffs.js';

const skip = diffOf('src/a.test.ts', hunk("+  it.skip('x', () => {})"));
const timeout = diffOf('src/b.test.ts', hunk('+  timeout: 9000,'));

describe('analyze', () => {
  it('reports nothing for an empty diff', () => {
    const report = analyze({ diff: '' });
    expect(report).toMatchObject({ schema: 1, ok: true, findings: [], counts: { high: 0 } });
  });

  it('echoes the range it was told about', () => {
    expect(analyze({ diff: '', base: 'origin/main' }).base).toBe('origin/main');
  });

  it('is not ok when a finding meets --fail-on', () => {
    expect(analyze({ diff: skip }).ok).toBe(false);
    expect(analyze({ diff: skip, failOn: 'none' }).ok).toBe(true);
  });

  it('treats low findings as passing until --fail-on says otherwise', () => {
    expect(analyze({ diff: timeout }).ok).toBe(true);
    expect(analyze({ diff: timeout, failOn: 'low' }).ok).toBe(false);
  });

  it('counts findings by severity', () => {
    const report = analyze({ diff: skip + timeout });
    expect(report.counts.high).toBe(1);
    expect(report.counts.low).toBe(1);
  });

  it('sorts the most severe finding first', () => {
    const report = analyze({ diff: timeout + skip });
    expect(report.findings[0]?.severity).toBe('high');
  });

  it('gives every finding a stable id', () => {
    const first = analyze({ diff: skip }).findings[0];
    const second = analyze({ diff: skip }).findings[0];
    expect(first?.id).toBe(second?.id);
    expect(first?.id).toContain('TEST_SKIPPED_ADDED');
  });

  it('honours extra test globs', () => {
    const diff = diffOf('checks/login.check.ts', hunk("+  it.skip('x', () => {})"));
    expect(analyze({ diff }).findings).toHaveLength(0);
    expect(analyze({ diff, testGlobs: [/\.check\.ts$/] }).findings).not.toHaveLength(0);
  });
});
