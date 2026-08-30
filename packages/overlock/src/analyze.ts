import { parseDiff } from './diff.js';
import { isTestFile } from './paths.js';
import { RULES } from './rules/index.js';
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
}

export function analyze(options: AnalyzeOptions): Report {
  const { diff, base = 'HEAD', testGlobs = [], failOn = 'high' } = options;

  const files = parseDiff(diff);
  const ctx = {
    files,
    isTest: (path: string) => isTestFile(path, testGlobs),
  };

  const raw = RULES.flatMap((rule) => rule.run(ctx));
  const findings = sortFindings(dedupe(raw));

  const counts: Record<Severity, number> = { high: 0, medium: 0, low: 0 };
  for (const f of findings) counts[f.severity] += 1;

  const ok =
    failOn === 'none'
      ? true
      : !findings.some((f) => SEVERITY_RANK[f.severity] <= SEVERITY_RANK[failOn]);

  return { schema: 1, ok, base, findings, counts };
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
    return a.line - b.line;
  });
}
