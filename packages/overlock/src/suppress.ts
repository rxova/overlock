import { sanitizePath, withoutStringContents } from './rules/shared.js';
import type { DiffFile, Finding, RuleId } from './types.js';
import { RULE_IDS } from './types.js';

/**
 * `overlock-ignore <RULE_ID> [<path>] -- <reason>`
 *
 * The reason is not optional, and that is the entire design.
 *
 * A gate with no escape hatch gets uninstalled the first time it is wrong about
 * a test somebody genuinely means to leave quarantined. A gate with a frictionless
 * escape hatch gets suppressed everywhere and stops meaning anything — which is
 * why `eslint-disable` needed a lint rule of its own to police it. Requiring a
 * named rule and a written reason keeps the hatch usable by a person explaining
 * themselves and useless to an agent looking for the shortest path to green.
 */
const SUPPRESSION = /overlock-ignore\s+([A-Z_]+)(?:\s+(?!--)(\S+))?\s*--\s*(\S.*?)\s*$/;

export interface Suppression {
  rule: RuleId;
  reason: string;
  /** The file the directive is written in. */
  file: string;
  /**
   * The path the directive covers, when it names one.
   *
   * This exists for the findings that have no line to sit on. A deleted test
   * file is the case: the rule reports on a path that no longer has a line 1,
   * so a comment cannot be put on the offending line — there isn't one. Naming
   * the path from a line that does exist (the replacement test file, most
   * often) is the only form that works, and it works in the hook's case as well
   * as in CI, which a commit trailer would not: at Stop time the work is
   * usually still uncommitted and has no commit message to read; only what was
   * committed during the session does.
   *
   * It is not a wildcard. A path-carrying directive covers only findings that
   * have no line of their own, so it can never blanket-silence a rule across a
   * file the way `eslint-disable-file` does.
   */
  target: string | null;
  /** Post-image line the comment sits on. */
  line: number;
  /**
   * True when this patch introduced the directive.
   *
   * The difference matters more than anything else in this file: a suppression
   * that was already in the tree records a decision somebody made and reviewed,
   * while one added by the same patch it silences is the agent writing its own
   * permission slip. Both still apply — but only the second is worth stopping
   * for, and the Stop hook does.
   */
  added: boolean;
}

function isRuleId(value: string): value is RuleId {
  return (RULE_IDS as readonly string[]).includes(value);
}

/**
 * Collects suppressions from the post-image of every file in the patch.
 *
 * Added and context lines both count: a comment written in this patch suppresses
 * this patch, and a comment already in the file keeps suppressing it. Removed
 * lines do not — a suppression someone just deleted should stop applying, which
 * is what makes deleting one a visible act rather than a silent one.
 */
export function collectSuppressions(files: DiffFile[]): Suppression[] {
  const found: Suppression[] = [];

  for (const file of files) {
    for (const hunk of file.hunks) {
      for (const line of hunk.lines) {
        if (line.kind === 'del' || line.newLine === null) continue;

        // Blanked the same way skip markers are: a directive quoted inside a
        // string is documentation or a fixture, not permission.
        const match = SUPPRESSION.exec(withoutStringContents(line.text));
        const rule = match?.[1];
        const target = match?.[2];
        const reason = match?.[3];
        // A malformed directive — no rule, an unknown rule, or no reason —
        // suppresses nothing. Silently ignoring it is deliberate: the finding it
        // failed to suppress is the feedback.
        if (!rule || !reason || !isRuleId(rule)) continue;

        found.push({
          rule,
          reason,
          target: target === undefined ? null : sanitizePath(target),
          file: file.path,
          line: line.newLine,
          added: line.kind === 'add',
        });
      }
    }
  }

  return found;
}

export interface SuppressionResult {
  kept: Finding[];
  suppressed: Finding[];
  /** The directives that did the silencing, for reporting what was silenced. */
  used: Suppression[];
}

/**
 * A suppression covers its own line and the one after it, so it can sit either
 * at the end of the offending line or on the line above it. It never covers a
 * whole file or a whole rule: blanket suppression is the failure mode this
 * format exists to avoid.
 *
 * A directive that names a path covers, in that path, only the findings that
 * carry no line — the ones no comment could ever sit on. Same ceiling: one
 * named rule, one named path, one written reason.
 */
export function applySuppressions(
  findings: Finding[],
  suppressions: Suppression[],
): SuppressionResult {
  if (suppressions.length === 0) return { kept: findings, suppressed: [], used: [] };

  const covered = new Map<string, Suppression>();
  for (const s of suppressions) {
    if (s.target !== null) {
      covered.set(`${s.rule}:${s.target}`, s);
      continue;
    }
    covered.set(`${s.rule}:${s.file}:${s.line}`, s);
    covered.set(`${s.rule}:${s.file}:${s.line + 1}`, s);
  }

  const kept: Finding[] = [];
  const suppressed: Finding[] = [];
  const used: Suppression[] = [];

  for (const finding of findings) {
    const key =
      finding.line === null
        ? `${finding.rule}:${finding.file}`
        : `${finding.rule}:${finding.file}:${finding.line}`;
    const directive = covered.get(key);
    if (directive) {
      suppressed.push(finding);
      if (!used.includes(directive)) used.push(directive);
    } else {
      kept.push(finding);
    }
  }

  return { kept, suppressed, used };
}
