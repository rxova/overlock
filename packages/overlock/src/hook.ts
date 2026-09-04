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

/**
 * What to say when the only thing standing between this patch and a pass is a
 * directive the patch itself wrote. The reasons are quoted verbatim, because
 * the claim is the thing being put to the person.
 */
function suppressionNotice(report: Report): string {
  const lines = [`overlock: this patch silenced ${report.suppressed_new} of its own findings.`, ''];

  for (const s of report.suppressions_new) {
    const covers = s.target === null ? '' : ` (covering ${s.target})`;
    lines.push(`! ${s.file}:${s.line} ${s.rule}${covers}`);
    lines.push(`   overlock-ignore ... -- ${s.reason}`);
  }

  return lines.join('\n');
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
  // A patch that silences its own findings passes every check and prints
  // nothing, which on a phone is indistinguishable from a clean run. Stopping
  // once is what puts the claim in front of the person: they can accept it and
  // carry on, but they cannot miss it.
  const laundered = report.ok && report.suppressed_new > 0;
  const reason = laundered ? suppressionNotice(report) : compact(report);

  if (report.ok && !laundered) {
    return { exitCode: 0, stdout: '', stderr: '' };
  }

  if (payload.stop_hook_active === true) {
    return {
      exitCode: 0,
      stdout: '',
      stderr: `${reason}\n\n(overlock: already retried once, not blocking again.)\n`,
    };
  }

  const body = {
    hookSpecificOutput: {
      hookEventName: 'Stop',
      blockStopReason: laundered
        ? `${reason}\n\nIf that is right, say so and finish. If not, fix the cause.`
        : `${reason}\n\nFix the cause, not the check, then finish.`,
    },
  };

  return {
    exitCode: 2,
    stdout: `${JSON.stringify(body)}\n`,
    stderr: `${body.hookSpecificOutput.blockStopReason}\n`,
  };
}
