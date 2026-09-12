import { sanitize, sanitizePath } from './rules/shared.js';
import type { Finding, RuleId } from './types.js';
import { RULE_IDS } from './types.js';

/**
 * `Overlock-Allow: <RULE_ID> [<target>] -- <reason>`
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
// Stops at the `--`; the reason is the rest of the line, sliced and trimmed. A
// pattern for the reason has to leave trailing whitespace out, and each way of
// writing that either backtracks across a long run of spaces or refuses the
// `\r` a CRLF body leaves at the end of every line.
const TRAILER = /^\s*Overlock-Allow:\s*([A-Z_]+)(?:\s+(?!--)("[^"]*"|\S+))?\s*--/i;

export interface Allowance {
  rule: RuleId;
  /**
   * Restricts the allowance to one path, or to one finding inside it.
   *
   * Three widths, and the narrow two exist because the wide one was the only
   * one there was. A file where fifteen removed cases were genuinely ported and
   * two were not is seventeen findings, and `TEST_REMOVED <path>` silences all
   * seventeen — including the two nobody has explained, and including the one
   * that turns out never to have landed.
   */
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
    // A case title has spaces in it, so a target naming one has to be quotable.
    const target = match?.[2]?.replace(/^"(.*)"$/, '$1');
    const reason = match ? line.slice(match[0].length).trim() : '';
    if (!rule || !reason || !isRuleId(rule)) continue;

    found.push({
      rule,
      target: target === undefined ? null : sanitizePath(target),
      reason: sanitize(reason),
    });
  }

  return found;
}

/**
 * Whether an allowance covers a finding.
 *
 * `<path>` is the file. `<path>:<line>` is one finding in it, written the way
 * every view of this tool prints a location, so the target can be copied out of
 * the report that raised it. `<path>::<name>` is the case a finding names, and
 * it is the one that survives an edit above it — a line number moves when a
 * line is added, a test title does not.
 */
function covers(allowance: Allowance, finding: Finding): boolean {
  if (allowance.rule !== finding.rule) return false;
  if (allowance.target === null) return true;
  if (allowance.target === finding.file) return true;
  if (finding.line !== null && allowance.target === `${finding.file}:${finding.line}`) return true;
  return (
    finding.subject !== undefined && allowance.target === `${finding.file}::${finding.subject}`
  );
}

export interface AllowResult {
  kept: Finding[];
  allowed: Finding[];
  /** The trailers that did the silencing, for reporting what was silenced. */
  used: Allowance[];
  /**
   * The trailers that silenced nothing.
   *
   * An acknowledgement is a claim about a finding. When the finding it names is
   * not in the patch, either the thing came back or it never landed where the
   * trailer said — and a directive that quietly matches nothing is how a list
   * of acknowledgements outlives the refactor it was written for.
   */
  unused: Allowance[];
}

export function applyAllowances(findings: Finding[], allowances: Allowance[]): AllowResult {
  if (allowances.length === 0) return { kept: findings, allowed: [], used: [], unused: [] };

  const kept: Finding[] = [];
  const allowed: Finding[] = [];
  const used: Allowance[] = [];

  for (const finding of findings) {
    const directive = allowances.find((a) => covers(a, finding));
    if (directive) {
      allowed.push(finding);
      if (!used.includes(directive)) used.push(directive);
    } else {
      kept.push(finding);
    }
  }

  return { kept, allowed, used, unused: allowances.filter((a) => !used.includes(a)) };
}
