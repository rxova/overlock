import type { DiffFile, Finding, RuleId } from './types.js';
import { RULE_IDS } from './types.js';

/**
 * `overlock-ignore <RULE_ID> -- <reason>`
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
const SUPPRESSION = /overlock-ignore\s+([A-Z_]+)\s*--\s*(\S.*?)\s*$/;

export interface Suppression {
  rule: RuleId;
  reason: string;
  file: string;
  /** Post-image line the comment sits on. */
  line: number;
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

        const match = SUPPRESSION.exec(line.text);
        const rule = match?.[1];
        const reason = match?.[2];
        // A malformed directive — no rule, an unknown rule, or no reason —
        // suppresses nothing. Silently ignoring it is deliberate: the finding it
        // failed to suppress is the feedback.
        if (!rule || !reason || !isRuleId(rule)) continue;

        found.push({ rule, reason, file: file.path, line: line.newLine });
      }
    }
  }

  return found;
}

export interface SuppressionResult {
  kept: Finding[];
  suppressed: Finding[];
}

/**
 * A suppression covers its own line and the one after it, so it can sit either
 * at the end of the offending line or on the line above it. It never covers a
 * whole file or a whole rule: blanket suppression is the failure mode this
 * format exists to avoid.
 */
export function applySuppressions(
  findings: Finding[],
  suppressions: Suppression[],
): SuppressionResult {
  if (suppressions.length === 0) return { kept: findings, suppressed: [] };

  const covered = new Set<string>();
  for (const s of suppressions) {
    covered.add(`${s.rule}:${s.file}:${s.line}`);
    covered.add(`${s.rule}:${s.file}:${s.line + 1}`);
  }

  const kept: Finding[] = [];
  const suppressed: Finding[] = [];

  for (const finding of findings) {
    if (covered.has(`${finding.rule}:${finding.file}:${finding.line}`)) suppressed.push(finding);
    else kept.push(finding);
  }

  return { kept, suppressed };
}
