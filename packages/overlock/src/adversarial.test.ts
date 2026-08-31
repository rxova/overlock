import { afterEach, describe, expect, it } from 'vitest';
import { symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { analyze } from './analyze.js';
import { stopHookOutcome } from './hook.js';
import { run } from './run.js';
import { diffOf, hunk } from './__fixtures__/diffs.js';
import { TempRepo } from './__fixtures__/repo.js';

/**
 * Written from the point of view of the adversary this tool actually has: not a
 * malicious human, but an agent optimising for a green check with full write
 * access to the repository — including to the files overlock reads.
 *
 * Every case here failed when it was written.
 */

let repo: TempRepo | null = null;
afterEach(() => {
  repo?.cleanup();
  repo = null;
});

describe('an agent that writes its own permission slip', () => {
  const selfCleared = diffOf(
    'src/auth.test.ts',
    hunk(
      [
        '+// overlock-ignore TEST_SKIPPED_ADDED -- flaky',
        "+it.skip('rejects expired tokens', () => {})",
      ].join('\n'),
    ),
  );

  it('is counted separately from a suppression that was already there', () => {
    const report = analyze({ diff: selfCleared });
    expect(report.suppressed).toBe(1);
    expect(report.suppressed_new).toBe(1);
  });

  it('does not count a pre-existing suppression as new', () => {
    const existing = diffOf(
      'src/auth.test.ts',
      hunk(
        [
          ' // overlock-ignore TEST_SKIPPED_ADDED -- quarantined, see #412',
          "+it.skip('rejects expired tokens', () => {})",
        ].join('\n'),
      ),
    );

    const report = analyze({ diff: existing });
    expect(report.suppressed).toBe(1);
    expect(report.suppressed_new).toBe(0);
  });

  // The whole point of the hook is that an agent cannot reach "done" by editing
  // the check. Silencing itself and exiting 0 with no output is exactly that,
  // and from a phone it is invisible.
  it('cannot reach a silent exit 0 through the Stop hook', () => {
    const outcome = stopHookOutcome(analyze({ diff: selfCleared }), {});

    expect(outcome.exitCode).toBe(2);
    expect(outcome.stderr).toContain('overlock-ignore');
    expect(outcome.stderr).toContain('flaky');
  });

  it('still stops after one round, so an honest suppression is not a loop', () => {
    const outcome = stopHookOutcome(analyze({ diff: selfCleared }), { stop_hook_active: true });
    expect(outcome.exitCode).toBe(0);
  });

  it('leaves a patch carrying only old suppressions alone', () => {
    const existing = diffOf(
      'src/auth.test.ts',
      hunk(
        [
          ' // overlock-ignore TEST_SKIPPED_ADDED -- quarantined, see #412',
          "+it.skip('rejects expired tokens', () => {})",
        ].join('\n'),
      ),
    );

    expect(stopHookOutcome(analyze({ diff: existing }), {}).exitCode).toBe(0);
  });
});

describe('a directive that is not a directive', () => {
  it('ignores one quoted inside a string literal', () => {
    const diff = diffOf(
      'src/auth.test.ts',
      hunk(
        [
          '+const doc = "write // overlock-ignore TEST_SKIPPED_ADDED -- like this";',
          "+it.skip('rejects', () => {})",
        ].join('\n'),
      ),
    );

    const report = analyze({ diff });
    expect(report.suppressed).toBe(0);
    expect(report.findings.map((f) => f.rule)).toContain('TEST_SKIPPED_ADDED');
  });

  it('still honours a real one whose reason contains quotes', () => {
    const diff = diffOf(
      'src/auth.test.ts',
      hunk(
        [
          '+// overlock-ignore TEST_SKIPPED_ADDED -- blocked on "vendor" fix, see #9',
          "+it.skip('rejects', () => {})",
        ].join('\n'),
      ),
    );

    expect(analyze({ diff }).suppressed).toBe(1);
  });
});

describe('a skip marker split across lines', () => {
  it('is still a skip marker', () => {
    const diff = diffOf(
      'src/auth.test.ts',
      hunk(['+it', "+  .skip('rejects expired tokens', () => {})"].join('\n')),
    );

    const report = analyze({ diff });
    expect(report.findings.map((f) => f.rule)).toContain('TEST_SKIPPED_ADDED');
    expect(report.ok).toBe(false);
  });

  it('catches the exclusive form the same way', () => {
    const diff = diffOf(
      'src/auth.test.ts',
      hunk(['+describe', "+  .only('suite', () => {})"].join('\n')),
    );
    expect(analyze({ diff }).ok).toBe(false);
  });

  it('does not invent one from an unrelated property access', () => {
    const diff = diffOf(
      'src/auth.test.ts',
      hunk(['+const runner = harness', '+  .skipBrokenSetup()'].join('\n')),
    );
    expect(analyze({ diff }).findings.map((f) => f.rule)).not.toContain('TEST_SKIPPED_ADDED');
  });
});

describe('content that is not source code', () => {
  it('never follows a symlink out of the repository', () => {
    const r = new TempRepo();
    repo = r;
    r.write('src/a.ts', 'export const x = 1;\n');
    r.commit('feat: first');

    const outside = join(r.dir, '..', `overlock-adversarial-${process.pid}.txt`);
    writeFileSync(outside, "SECRET=hunter2\nit.skip('leak me', () => {})\n");
    symlinkSync(outside, join(r.dir, 'src', 'leak.test.ts'));

    const { report } = run({ cwd: r.dir, base: 'auto', ledger: false, failOn: 'none' });

    expect(JSON.stringify(report)).not.toContain('leak me');
    expect(JSON.stringify(report)).not.toContain('hunter2');
  });

  // Evidence is printed to a terminal, handed to an agent, and pasted into pull
  // request comments. A test name carrying an erase-line sequence can rewrite
  // the verdict above it.
  it('strips control characters out of evidence and messages', () => {
    const nasty = `+it.skip('x[2K\r[32m ok clean[0m', () => {})`;
    const report = analyze({ diff: diffOf('src/a.test.ts', hunk(nasty)) });
    const serialised = JSON.stringify(report);

    expect(serialised).not.toContain('');
    expect(report.findings[0]?.evidence.after).not.toContain('\r');
  });

  it('caps a single enormous line instead of carrying it everywhere', () => {
    const huge = `+it.skip('${'A'.repeat(400_000)}', () => {})`;
    const report = analyze({ diff: diffOf('src/a.test.ts', hunk(huge)) });

    expect(report.findings[0]?.evidence.after?.length).toBeLessThan(2_000);
  });

  it('caps a message built from diff content too', () => {
    const long = 'B'.repeat(100_000);
    const diff = diffOf(
      'src/a.test.ts',
      hunk([`-  expect(x).toBe('short');`, `+  expect(x).toBe('${long}');`].join('\n')),
    );

    const message = analyze({ diff }).findings[0]?.message ?? '';
    expect(message.length).toBeLessThan(2_000);
  });
});

describe('a repository with no commits', () => {
  it('is analysed rather than rejected as not a repository', () => {
    const r = new TempRepo();
    repo = r;
    r.write('src/a.test.ts', "it.skip('rejects', () => {})\n");

    const { report } = run({ cwd: r.dir, base: 'auto', ledger: false });

    expect(report.findings.map((f) => f.rule)).toContain('TEST_SKIPPED_ADDED');
    expect(report.ok).toBe(false);
  });
});
