import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { analyze } from './analyze.js';
import { patchClaims, type Claim, type SuppressionMemory } from './announced.js';
import { parseStopPayload, sessionBase, sessionStart, stopHookOutcome } from './hook.js';
import { diffOf, hunk } from './__fixtures__/diffs.js';
import { PASSING_TEST, SKIPPED_TEST, TempRepo } from './__fixtures__/repo.js';

const clean = analyze({ diff: '' });
const dirty = analyze({ diff: diffOf('src/a.test.ts', hunk("+  it.skip('x', () => {})")) });

describe('parseStopPayload', () => {
  it('accepts an empty or malformed payload', () => {
    expect(parseStopPayload('')).toEqual({});
    expect(parseStopPayload('not json')).toEqual({});
    expect(parseStopPayload('null')).toEqual({});
    expect(parseStopPayload('"a string"')).toEqual({});
  });

  it('reads the loop guard', () => {
    expect(parseStopPayload('{"stop_hook_active":true}').stop_hook_active).toBe(true);
  });

  it('reads the transcript path', () => {
    expect(parseStopPayload('{"transcript_path":"/tmp/session.jsonl"}').transcript_path).toBe(
      '/tmp/session.jsonl',
    );
  });
});

describe('the session a Stop hook is asked about', () => {
  let repo: TempRepo | null = null;

  afterEach(() => {
    repo?.cleanup();
    repo = null;
  });

  /**
   * A transcript file, standing in for the one Claude Code writes. It is
   * created now, because a session starts now: the commits are what move, since
   * birth time is the one timestamp a test cannot portably set — `utimes` moves
   * mtime, and whether that drags birth time with it is a property of the
   * filesystem, not of Node.
   */
  function transcript(): string {
    const file = join(mkdtempSync(join(tmpdir(), 'overlock-session-')), 'session.jsonl');
    writeFileSync(file, '{}\n', 'utf8');
    return file;
  }

  /** Well before any session these tests start. */
  const EARLIER = new Date(Date.now() - 60 * 60 * 1000);
  /** After it, for the case where every commit is outside the session. */
  const LATER = new Date(Date.now() + 60 * 60 * 1000);

  describe('sessionStart', () => {
    it('is when the transcript was created', () => {
      const started = sessionStart({ transcript_path: transcript() });
      expect(started).toBeInstanceOf(Date);
      expect(Math.abs(Date.now() - (started as Date).getTime())).toBeLessThan(60_000);
    });

    it('is nothing without a usable path', () => {
      expect(sessionStart({})).toBeNull();
      expect(sessionStart({ transcript_path: '' })).toBeNull();
      expect(sessionStart({ transcript_path: 42 as unknown as string })).toBeNull();
      expect(sessionStart({ transcript_path: '/nowhere/session.jsonl' })).toBeNull();
      // A directory has a birth time too, but there is no session in it.
      expect(sessionBase({ transcript_path: '/nowhere/session.jsonl' }, '/')).toBeNull();
    });
  });

  describe('sessionBase', () => {
    it('is the commit the session started from', () => {
      const r = new TempRepo();
      repo = r;
      r.write('src/a.test.ts', PASSING_TEST);
      r.commit('feat: before the session', { at: EARLIER });
      const before = r.git(['rev-parse', 'HEAD']).trim();

      // The transcript is dated after that commit, so the commit is the base.
      const file = transcript();
      r.write('src/a.test.ts', SKIPPED_TEST);
      r.commit('chore: what the agent did');

      expect(sessionBase({ transcript_path: file }, r.dir)).toBe(before);
    });

    it('is nothing when the session predates every commit', () => {
      const file = transcript();
      const r = new TempRepo();
      repo = r;
      r.write('a.txt', 'one\n');
      // Dated after the session began, so there is nothing before it to anchor
      // on — which is a fresh repository, or a clock nobody should trust.
      r.commit('feat: first', { at: LATER });

      expect(sessionBase({ transcript_path: file }, r.dir)).toBeNull();
    });

    it('is nothing without a transcript, so the caller falls back', () => {
      const r = new TempRepo();
      repo = r;
      r.write('a.txt', 'one\n');
      r.commit('feat: first');

      expect(sessionBase({}, r.dir)).toBeNull();
    });

    it('is nothing outside a repository', () => {
      expect(sessionBase({ transcript_path: transcript() }, '/')).toBeNull();
    });
  });
});

describe('stopHookOutcome', () => {
  it('exits silently when the patch is clean', () => {
    expect(stopHookOutcome(clean, {})).toEqual({ exitCode: 0, stdout: '', stderr: '' });
  });

  it('blocks with exit 2 and the documented JSON shape', () => {
    const outcome = stopHookOutcome(dirty, {});
    expect(outcome.exitCode).toBe(2);

    const parsed = JSON.parse(outcome.stdout) as {
      hookSpecificOutput: { hookEventName: string; blockStopReason: string };
    };
    expect(parsed.hookSpecificOutput.hookEventName).toBe('Stop');
    expect(parsed.hookSpecificOutput.blockStopReason).toContain('TEST_SKIPPED_ADDED');
  });

  it('repeats the reason on stderr, because that is the channel that surfaces', () => {
    expect(stopHookOutcome(dirty, {}).stderr).toContain('TEST_SKIPPED_ADDED');
  });

  it('reports but does not block a second time', () => {
    const outcome = stopHookOutcome(dirty, { stop_hook_active: true });
    expect(outcome.exitCode).toBe(0);
    expect(outcome.stderr).toContain('not blocking again');
  });
});

/**
 * A trailer is written by the patch by definition — it lives in the commit
 * message of a commit in the range — so the hook puts the claim in front of the
 * person on the same terms as a directive the patch wrote for itself.
 */
describe('a patch that acknowledged itself with a trailer', () => {
  const allowed = analyze({
    diff: diffOf('src/a.test.ts', hunk("+  it.skip('x', () => {})")),
    allowText: 'Overlock-Allow: TEST_SKIPPED_ADDED src/a.test.ts -- quarantined pending #412',
  });

  it('stops once and quotes the reason back', () => {
    expect(allowed.ok).toBe(true);

    const outcome = stopHookOutcome(allowed, {});
    expect(outcome.exitCode).toBe(2);
    expect(outcome.stderr).toContain('silenced 1 of its own findings');
    expect(outcome.stderr).toContain('quarantined pending #412');
    expect(outcome.stderr).toContain('covering src/a.test.ts');
  });

  it('does not stop twice', () => {
    expect(stopHookOutcome(allowed, { stop_hook_active: true }).exitCode).toBe(0);
  });

  it('quotes a trailer that names no path without inventing one', () => {
    const report = analyze({
      diff: diffOf('src/a.test.ts', hunk("+  it.skip('x', () => {})")),
      allowText: 'Overlock-Allow: TEST_SKIPPED_ADDED -- the whole rename, see the description',
    });

    const outcome = stopHookOutcome(report, {});
    expect(outcome.stderr).toContain('the whole rename');
    expect(outcome.stderr).not.toContain('covering');
  });
});

describe('a patch that silenced itself inline', () => {
  it('quotes back a directive the patch added, with the line it sits on', () => {
    const report = analyze({
      diff: diffOf(
        'src/a.test.ts',
        hunk(
          [
            '+  // overlock-ignore TEST_SKIPPED_ADDED -- quarantined pending #412',
            "+  it.skip('x', () => {})",
          ].join('\n'),
        ),
      ),
    });

    const outcome = stopHookOutcome(report, {});
    expect(outcome.exitCode).toBe(2);
    expect(outcome.stderr).toContain('silenced 1 of its own findings');
    expect(outcome.stderr).toContain('src/a.test.ts:');
    expect(outcome.stderr).toContain('quarantined pending #412');
    expect(outcome.stderr).not.toContain('covering');
  });

  it('names what a path-scoped directive covers', () => {
    const report = analyze({
      diff:
        diffOf('src/gone.test.ts', hunk("-it('x', () => {})"), { status: 'deleted' }) +
        diffOf(
          'src/store.test.ts',
          hunk('+// overlock-ignore TEST_REMOVED src/gone.test.ts -- re-homed in store.test.ts'),
          { status: 'added' },
        ),
    });

    const outcome = stopHookOutcome(report, {});
    expect(outcome.stderr).toContain('covering src/gone.test.ts');
    expect(outcome.stderr).toContain('re-homed in store.test.ts');
  });
});

/**
 * The Stop hook is a fresh process every turn, and `stop_hook_active` is set
 * only on the Stop that directly follows a blocked one. Without a memory of
 * what it already quoted, "stops once" means once per turn: the same directive
 * stopped the agent on every turn until the branch merged.
 */
describe('a claim already put to a person', () => {
  /** What `suppressionMemory` gives the hook, with the writes kept in memory. */
  function memory(seen: Iterable<string> = []): SuppressionMemory & { recorded: Claim[] } {
    const recorded: Claim[] = [];
    return {
      seen: new Set(seen),
      remember: (claims) => recorded.push(...claims),
      recorded,
    };
  }

  function silenced(reason: string, padding = 0) {
    return analyze({
      diff: diffOf(
        'src/a.test.ts',
        hunk(
          [
            ...Array.from({ length: padding }, (_, i) => `+const unrelated${i} = ${i};`),
            `+  // overlock-ignore TEST_SKIPPED_ADDED -- ${reason}`,
            "+  it.skip('x', () => {})",
          ].join('\n'),
        ),
      ),
    });
  }

  it('stops the first turn and records what it quoted', () => {
    const report = silenced('flaky');
    const seen = memory();

    expect(stopHookOutcome(report, {}, seen).exitCode).toBe(2);
    expect(seen.recorded).toEqual(patchClaims(report));
  });

  it('does not stop the next turn, and says nothing', () => {
    const report = silenced('flaky');
    const keys = patchClaims(report).map((c) => c.key);

    // A new turn: `stop_hook_active` is false again, and the directive is still
    // new against the same base.
    const outcome = stopHookOutcome(report, {}, memory(keys));
    expect(outcome.exitCode).toBe(0);
    expect(outcome.stdout).toBe('');
    expect(outcome.stderr).toBe('');
    expect(outcome.bypass).toBe('announced');
  });

  it('does not stop when the directive has only moved down the file', () => {
    const keys = patchClaims(silenced('flaky')).map((c) => c.key);
    expect(stopHookOutcome(silenced('flaky', 6), {}, memory(keys)).exitCode).toBe(0);
  });

  it('records nothing twice, because the turn it would record was not stopped', () => {
    const keys = patchClaims(silenced('flaky')).map((c) => c.key);
    const seen = memory(keys);

    stopHookOutcome(silenced('flaky'), {}, seen);
    expect(seen.recorded).toEqual([]);
  });

  it('stops again when the reason changes', () => {
    const keys = patchClaims(silenced('flaky')).map((c) => c.key);
    const outcome = stopHookOutcome(silenced('quarantined pending #412'), {}, memory(keys));

    expect(outcome.exitCode).toBe(2);
    expect(outcome.stderr).toContain('quarantined pending #412');
  });

  it('stops again when the patch adds a second claim', () => {
    const report = analyze({
      diff:
        diffOf(
          'src/a.test.ts',
          hunk(
            ['+  // overlock-ignore TEST_SKIPPED_ADDED -- flaky', "+  it.skip('x', () => {})"].join(
              '\n',
            ),
          ),
        ) +
        diffOf(
          'src/b.test.ts',
          hunk(
            [
              '+  // overlock-ignore TEST_SKIPPED_ADDED -- also flaky',
              "+  it.skip('y', () => {})",
            ].join('\n'),
          ),
        ),
    });
    const [first] = patchClaims(report);

    const outcome = stopHookOutcome(report, {}, memory([first?.key as string]));
    expect(outcome.exitCode).toBe(2);
    expect(outcome.stderr).toContain('silenced 2 of its own findings');
  });

  it('still stops on a finding nobody silenced, however many turns it takes', () => {
    const seen = memory(patchClaims(dirty).map((c) => c.key));
    expect(stopHookOutcome(dirty, {}, seen).exitCode).toBe(2);
    expect(stopHookOutcome(dirty, {}, seen).exitCode).toBe(2);
  });

  it('still lets the retry through, and still says why', () => {
    // The retry directly follows the stop that recorded the claim, so the
    // memory already holds it — and the agent is still told, as it always was.
    const report = silenced('flaky');
    const outcome = stopHookOutcome(
      report,
      { stop_hook_active: true },
      memory(patchClaims(report).map((c) => c.key)),
    );

    expect(outcome.exitCode).toBe(0);
    expect(outcome.stderr).toContain('not blocking again');
    expect(outcome.bypass).toBe('retry');
  });

  it('stops without a memory at all, which is where this started', () => {
    expect(stopHookOutcome(silenced('flaky'), {}).exitCode).toBe(2);
  });
});
