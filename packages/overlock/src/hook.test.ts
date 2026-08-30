import { describe, expect, it } from 'vitest';
import { analyze } from './analyze.js';
import { parseStopPayload, stopHookOutcome } from './hook.js';
import { diffOf, hunk } from './__fixtures__/diffs.js';

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
