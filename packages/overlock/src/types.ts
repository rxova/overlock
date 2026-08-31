/**
 * The wire contract.
 *
 * These field names are snake_case where the published JSON is snake_case, on
 * purpose: this schema is the product's real API — hooks, CI jobs, the MCP
 * server and any dashboard built later all read it — and a camelCase interface
 * mapped to a snake_case payload is exactly the seam where the two drift. One
 * shape, one name per field, no mapping layer.
 *
 * Rule IDs are frozen. Adding a rule is a minor release; changing what an
 * existing ID means is a breaking one.
 */

/**
 * `high` is "I would not have merged this had I seen it" — the tier that blocks
 * by default. `medium` is "worth a look, plausibly deliberate". `low` is
 * context: true often enough that blocking on it would train you to uninstall.
 */
export type Severity = 'high' | 'medium' | 'low';

export const RULE_IDS = [
  'TEST_REMOVED',
  'TEST_SKIPPED_ADDED',
  'ASSERTION_REMOVED',
  'ASSERTION_WEAKENED',
  'EXPECTED_VALUE_CHANGED',
  'SNAPSHOT_UPDATED_WITH_CODE',
  'COVERAGE_THRESHOLD_LOWERED',
  'TEST_TIMEOUT_RAISED',
  'TEST_AND_IMPL_TOGETHER',
] as const;

export type RuleId = (typeof RULE_IDS)[number];

export interface Evidence {
  /** The removed line, verbatim and untruncated by the engine. */
  before?: string;
  /** The added line, verbatim and untruncated by the engine. */
  after?: string;
}

export interface Finding {
  /**
   * Stable within a patch: `<rule>:<file>:<line>`. Deduplicates a finding that
   * two runs of the same check would both report, and gives the ledger
   * something to join on.
   */
  id: string;
  rule: RuleId;
  severity: Severity;
  file: string;
  /** 1-indexed, in the post-image for additions and the pre-image for removals. */
  line: number;
  message: string;
  evidence: Evidence;
  fix_hint: string;
}

export interface Report {
  /** Schema version of this payload, independent of the package version. */
  schema: 1;
  ok: boolean;
  /** The git range actually analysed, as resolved — never the literal `auto`. */
  base: string;
  findings: Finding[];
  counts: Record<Severity, number>;
  /**
   * Findings an `overlock-ignore` comment silenced. Reported rather than simply
   * dropped: an escape hatch nobody can count is one that quietly empties the
   * gate, and this number is what makes a rising suppression rate visible.
   */
  suppressed: number;
}

export type DiffLineKind = 'add' | 'del' | 'ctx';

export interface DiffLine {
  kind: DiffLineKind;
  text: string;
  /** 1-indexed line number in the pre-image, or null for an addition. */
  oldLine: number | null;
  /** 1-indexed line number in the post-image, or null for a removal. */
  newLine: number | null;
}

export interface Hunk {
  oldStart: number;
  newStart: number;
  lines: DiffLine[];
}

export type FileStatus = 'added' | 'modified' | 'deleted' | 'renamed';

export interface DiffFile {
  /** Post-image path, or the pre-image path when the file was deleted. */
  path: string;
  oldPath: string | null;
  status: FileStatus;
  hunks: Hunk[];
}
