import { applyAllowances, collectAllowances } from './allow.js';
import { parseDiff } from './diff.js';
import { explainPatch, type PatchExplanation } from './substitution.js';
import { isTestFile } from './paths.js';
import { RULES } from './rules/index.js';
import { sanitize } from './rules/shared.js';
import { applySuppressions, collectSuppressions } from './suppress.js';
import type { Finding, Report, RuleId, Severity } from './types.js';

const SEVERITY_RANK: Record<Severity, number> = { high: 0, medium: 1, low: 2 };

export interface AnalyzeOptions {
  /** Raw `git diff` text. */
  diff: string;
  /** The resolved range, echoed into the report so a log says what was checked. */
  base?: string;
  /** Extra patterns that mark a path as a test file. */
  testGlobs?: RegExp[];
  /** Severity at or above which the report is not ok. Default `high`. */
  failOn?: Severity | 'none';
  /**
   * Per-rule severity, replacing the built-in grade for those rules.
   *
   * A repository that deletes test files as a matter of course — because
   * deleting a feature deletes its tests — otherwise has one lever, `--fail-on
   * medium`, and pulling it to unblock TEST_REMOVED also unblocks
   * TEST_SKIPPED_ADDED, ASSERTION_WEAKENED and COVERAGE_THRESHOLD_LOWERED. An
   * escape from one rule should not disarm four.
   */
  severities?: Partial<Record<RuleId, Severity>>;
  /**
   * Commit messages and pull request body for the patch, searched for
   * `Overlock-Allow:` trailers. Empty at Stop time, where uncommitted work has
   * no message to read.
   */
  allowText?: string;
}

/**
 * An unrecognised level used to make every severity comparison false, so a
 * patch carrying a HIGH finding reported `ok`. A gate given a value it does not
 * understand has to fail closed.
 */
function normalizeFailOn(value: Severity | 'none'): Severity | 'none' {
  return value === 'none' || value in SEVERITY_RANK ? value : 'high';
}

export function analyze(options: AnalyzeOptions): Report {
  const { diff, base = 'HEAD', testGlobs = [] } = options;
  const failOn = normalizeFailOn(options.failOn ?? 'high');

  const severities = options.severities ?? {};

  const files = parseDiff(diff);
  const explanation = explainPatch(files);
  const ctx = {
    files,
    isTest: (path: string) => isTestFile(path, testGlobs),
  };

  const raw = RULES.flatMap((rule) => rule.run(ctx)).map((f) => regrade(f, severities));
  const { kept, suppressed, used } = applySuppressions(
    sortFindings(dedupe(raw)),
    collectSuppressions(files),
  );
  const allowances = collectAllowances(options.allowText ?? '');
  const { kept: standing, allowed, used: usedAllowances } = applyAllowances(kept, allowances);

  const findings = standing.map((f) => annotate(f, explanation));
  const freshlyAdded = used.filter((s) => s.added);

  const counts: Record<Severity, number> = { high: 0, medium: 0, low: 0 };
  for (const f of findings) counts[f.severity] += 1;

  const ok =
    failOn === 'none'
      ? true
      : !findings.some((f) => SEVERITY_RANK[f.severity] <= SEVERITY_RANK[failOn]);

  return {
    schema: 1,
    ok,
    base,
    findings,
    counts,
    renames: explanation.renames,
    explained: findings.filter((f) => f.explained_by !== undefined).length,
    allowed: usedAllowances,
    // Allowed findings are counted here too: a silenced finding that leaves no
    // trace in the output is how a gate ends up passing everything, and the
    // mechanism that silenced it does not change that.
    suppressed: suppressed.length + allowed.length,
    suppressed_new: freshlyAdded.length,
    suppressions_new: freshlyAdded.map((s) => ({
      rule: s.rule,
      file: s.file,
      line: s.line,
      target: s.target,
      reason: sanitize(s.reason),
    })),
  };
}

/**
 * Marks a finding the rest of the patch accounts for.
 *
 * Evidence first, because it is the specific claim: these two lines are the
 * same line with the substitution applied. Where a rule reports no before and
 * after — a file-level finding — the file's own verdict stands in.
 *
 * Note what this deliberately does not do: it does not touch `severity`, and it
 * is not subtracted from `ok`. An inferred substitution is a heuristic, and a
 * patch large enough to establish one is a patch large enough to hide a real
 * edit inside. Deciding a rename is fine is a person's call, and
 * `Overlock-Allow:` is where they make it.
 */
function annotate(f: Finding, explanation: PatchExplanation): Finding {
  const { before, after } = f.evidence;
  const verdict =
    (before !== undefined && after !== undefined
      ? explanation.explainsEdit(before, after)
      : null) ??
    explanation.files.get(f.file) ??
    null;

  if (verdict === null) return f;
  return {
    ...f,
    explained_by: verdict === 'rename' ? (explanation.label ?? 'a rename') : 'reformatting only',
  };
}

/**
 * Applied before sorting, deduplication and suppression, so an override changes
 * the order a finding is reported in and whether it blocks, not merely the word
 * printed beside it.
 */
function regrade(f: Finding, severities: Partial<Record<RuleId, Severity>>): Finding {
  const override = severities[f.rule];
  return override === undefined || override === f.severity ? f : { ...f, severity: override };
}

/**
 * Two passes, both narrow on purpose.
 *
 * Identical `id`s collapse — the same rule cannot report the same line twice.
 * And EXPECTED_VALUE_CHANGED is suppressed where ASSERTION_WEAKENED already
 * fired on the same line, because they are the same edit seen twice: replacing
 * `toBe(3)` with `toBeDefined()` changes both the matcher and the literal.
 * Nothing else is merged; findings from different rules are different facts and
 * silently dropping one to shorten the report is how a tool stops being
 * trustworthy.
 */
function dedupe(findings: Finding[]): Finding[] {
  const byId = new Map<string, Finding>();
  for (const f of findings) if (!byId.has(f.id)) byId.set(f.id, f);

  const weakened = new Set(
    [...byId.values()]
      .filter((f) => f.rule === 'ASSERTION_WEAKENED')
      .map((f) => `${f.file}:${f.line}`),
  );

  return [...byId.values()].filter(
    (f) => !(f.rule === 'EXPECTED_VALUE_CHANGED' && weakened.has(`${f.file}:${f.line}`)),
  );
}

/** Registry position per rule. A total record, so lookup needs no fallback. */
const RULE_ORDER = Object.fromEntries(RULES.map((r, i) => [r.rule, i])) as Record<RuleId, number>;

function sortFindings(findings: Finding[]): Finding[] {
  return [...findings].sort((a, b) => {
    const bySeverity = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
    if (bySeverity !== 0) return bySeverity;
    const byRule = RULE_ORDER[a.rule] - RULE_ORDER[b.rule];
    if (byRule !== 0) return byRule;
    if (a.file !== b.file) return a.file < b.file ? -1 : 1;
    // A finding about the whole file sorts above the lines inside it, which is
    // also the order a person would read them in.
    return (a.line ?? 0) - (b.line ?? 0);
  });
}
