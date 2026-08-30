import { compact } from './report.js';
import type { Report } from './types.js';

export interface HookOutcome {
  exitCode: number;
  stdout: string;
  stderr: string;
}

interface StopPayload {
  /**
   * Claude Code sets this when the current turn is already a continuation
   * caused by a Stop hook. Blocking again from here is how a hook turns a
   * failed fix into an infinite loop, so this is the one case where a real
   * finding is reported without stopping the agent.
   */
  stop_hook_active?: boolean;
  [key: string]: unknown;
}

export function parseStopPayload(raw: string): StopPayload {
  if (!raw.trim()) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null ? (parsed as StopPayload) : {};
  } catch {
    // A hook that cannot parse its input still has a job to do. The payload
    // only carries the loop guard; everything else comes from git.
    return {};
  }
}

/**
 * Speaks the Stop hook protocol.
 *
 * Exit 2 is what actually blocks; the JSON on stdout carries the reason in the
 * documented shape, and the same text goes to stderr because that is what
 * Claude Code surfaces when a hook blocks. Belt and braces on purpose: this
 * string is the only thing that reaches a person reading on a phone, so it is
 * worth sending twice rather than discovering one channel was the wrong one.
 */
export function stopHookOutcome(report: Report, payload: StopPayload): HookOutcome {
  const reason = compact(report);

  if (report.ok) {
    return { exitCode: 0, stdout: '', stderr: '' };
  }

  if (payload.stop_hook_active === true) {
    return {
      exitCode: 0,
      stdout: '',
      stderr: `${reason}\n\n(patchfinder: already retried once, not blocking again.)\n`,
    };
  }

  const body = {
    hookSpecificOutput: {
      hookEventName: 'Stop',
      blockStopReason: `${reason}\n\nFix the cause, not the check, then finish.`,
    },
  };

  return {
    exitCode: 2,
    stdout: `${JSON.stringify(body)}\n`,
    stderr: `${body.hookSpecificOutput.blockStopReason}\n`,
  };
}
