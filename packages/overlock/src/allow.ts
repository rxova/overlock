import { sanitize, sanitizePath } from './rules/shared.js';
import type { Finding, RuleId } from './types.js';
import { RULE_IDS } from './types.js';

/**
 * `Overlock-Allow: <RULE_ID> [<path>] -- <reason>`
 *
 * The patch-level form of the inline directive, read from the commit messages
 * in the range and from the pull request body when the caller supplies one.
 *
 * The inline directive is the right shape for a finding about a line. It is the
 * wrong shape for a rename touching six hundred files, where using it means
 * adding twenty comments to source files and deleting them again — worse than
 * the noise it silences. Anyone running `--fail-on medium` across a rename
 * otherwise has an unmergeable pull request and no proportionate way out.
 *
 * The ceiling is the same as everywhere else in this tool: a named rule and a
 * written reason, never a wildcard across rules. What it gives up is the line,
 * which is the whole point — and what it costs is that the acknowledgement is
 * written where a reviewer reads it rather than buried in a source file.
 *
 * It is deliberately a trailer and not a second inline syntax: at Stop time it
 * covers only what the agent committed during the session, and work still in
 * the tree has no commit message to read. That is why it is an addition to the
 * inline directive rather than a replacement for it.
 */
const TRAILER = /^\s*Overlock-Allow:\s*([A-Z_]+)(?:\s+(?!--)(\S+))?\s*--\s*(\S.*?)\s*$/i;

export interface Allowance {
  rule: RuleId;
  /** Restricts the allowance to one path, when it names one. */
  target: string | null;
  reason: string;
}

function isRuleId(value: string): value is RuleId {
  return (RULE_IDS as readonly string[]).includes(value);
}

/**
 * Reads every trailer in a block of text.
 *
 * The text is a commit message or a pull request body, so it is written by
 * whoever opened the patch. A malformed trailer — no rule, an unknown rule, no
 * reason — allows nothing, and says so by leaving the finding standing.
 */
export function collectAllowances(text: string): Allowance[] {
  const found: Allowance[] = [];

  for (const line of text.split('\n')) {
    const match = TRAILER.exec(line);
    const rule = match?.[1]?.toUpperCase();
    const target = match?.[2];
    const reason = match?.[3];
    if (!rule || !reason || !isRuleId(rule)) continue;

    found.push({
      rule,
      target: target === undefined ? null : sanitizePath(target),
      reason: sanitize(reason),
    });
  }

  return found;
}

export interface AllowResult {
  kept: Finding[];
  allowed: Finding[];
  /** The trailers that did the silencing, for reporting what was silenced. */
  used: Allowance[];
}

export function applyAllowances(findings: Finding[], allowances: Allowance[]): AllowResult {
  if (allowances.length === 0) return { kept: findings, allowed: [], used: [] };

  const kept: Finding[] = [];
  const allowed: Finding[] = [];
  const used: Allowance[] = [];

  for (const finding of findings) {
    const directive = allowances.find(
      (a) => a.rule === finding.rule && (a.target === null || a.target === finding.file),
    );
    if (directive) {
      allowed.push(finding);
      if (!used.includes(directive)) used.push(directive);
    } else {
      kept.push(finding);
    }
  }

  return { kept, allowed, used };
}
