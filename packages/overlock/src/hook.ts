import { statSync } from 'node:fs';
import { commitBefore } from './git.js';
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
  /**
   * The session's own transcript. Its creation time is when the session began,
   * which is the only anchor available at Stop time for "what did this agent
   * do" — see `sessionBase`.
   */
  transcript_path?: string;
  [key: string]: unknown;
}

/**
 * What to say when the only thing standing between this patch and a pass is a
 * directive the patch itself wrote. The reasons are quoted verbatim, because
 * the claim is the thing being put to the person.
 */
function suppressionNotice(report: Report): string {
  const silenced = report.suppressed_new + report.allowed.length;
  const lines = [`overlock: this patch silenced ${silenced} of its own findings.`, ''];

  for (const s of report.suppressions_new) {
    const covers = s.target === null ? '' : ` (covering ${s.target})`;
    lines.push(`! ${s.file}:${s.line} ${s.rule}${covers}`);
    lines.push(`   overlock-ignore ... -- ${s.reason}`);
  }

  // A trailer is written by the patch by definition — it lives in the commit
  // message of a commit in the range — so it is quoted back on the same terms.
  for (const a of report.allowed) {
    const covers = a.target === null ? '' : ` (covering ${a.target})`;
    lines.push(`! commit message ${a.rule}${covers}`);
    lines.push(`   Overlock-Allow: ... -- ${a.reason}`);
  }

  return lines.join('\n');
}

/**
 * When this session started, from the transcript the payload names.
 *
 * There is nothing else to ask. A Stop hook is handed a session id and a
 * transcript path, and the transcript is created when the session is — so its
 * birth time is the session's.
 *
 * Birth time only. `mtime` is the obvious fallback and it is the wrong one: a
 * transcript is written to throughout the session, so during a live session its
 * mtime is roughly now, and a base measured from now covers nothing. Where the
 * filesystem records no birth time, this returns null and `auto` answers — the
 * behaviour before any of this existed, rather than a session that silently
 * looks empty.
 */
export function sessionStart(payload: StopPayload): Date | null {
  const path = payload.transcript_path;
  if (typeof path !== 'string' || path === '') return null;

  try {
    const { birthtime, birthtimeMs } = statSync(path);
    return birthtimeMs > 0 ? birthtime : null;
  } catch {
    // No transcript to read. The caller falls back to `auto`.
    return null;
  }
}

/**
 * What the agent did during this session: the commit the session started from.
 *
 * The hook used to read the working tree, and agents commit and then stop — so
 * a hook whose entire purpose is finding out what a coding agent did to your
 * tests saw nothing at all in the ordinary case. Anchoring on the last commit
 * made before the session began covers both halves at once: everything
 * committed since, and everything still uncommitted.
 *
 * Null when there is no transcript, no commit before it, or no repository — and
 * `auto` answers instead, which is what happened before this existed.
 */
export function sessionBase(payload: StopPayload, cwd: string): string | null {
  const started = sessionStart(payload);
  if (started === null) return null;

  // A second earlier, because git's `--before` is inclusive and works in whole
  // seconds: a commit made in the same second the session began would otherwise
  // count as predating it and fall outside the patch. Erring by a second in
  // this direction includes a commit that was not the agent's; erring the other
  // way hides one that was.
  return commitBefore(new Date(started.getTime() - 1_000), cwd);
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
  const laundered = report.ok && (report.suppressed_new > 0 || report.allowed.length > 0);
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
