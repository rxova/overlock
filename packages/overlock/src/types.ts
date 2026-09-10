/**
 * The wire contract.
 *
 * These field names are snake_case where the published JSON is snake_case, on
 * purpose: this schema is the public API — hooks, CI jobs, the MCP server and
 * anything reading the reports later all consume it — and a camelCase interface
 * mapped to a snake_case payload is the seam where the two drift. One shape,
 * one name per field, no mapping layer.
 *
 * Rule IDs are frozen. Adding a rule is a minor release; changing what an
 * existing ID means is a breaking one.
 */

/**
 * `high` means a reviewer who saw it would not have merged the change, and is
 * the tier that fails a run by default. `medium` means worth a look, plausibly
 * deliberate. `low` is context: true often enough on ordinary work that
 * blocking on it would be noise.
 */
export type Severity = 'high' | 'medium' | 'low';

/**
 * What a repository may grade a rule as, which is one more thing than a finding
 * may carry: `off`.
 *
 * A grade is a policy about a rule; a severity is a fact about a finding. They
 * were the same three words while every rule had a grade worth reporting, and
 * `off` is what separates them — a rule graded `off` produces no findings, so
 * no finding can ever carry it. Keeping `Severity` as it was is also what keeps
 * `counts` a total record of three keys on the wire.
 */
export type Grade = Severity | 'off';

/**
 * A substitution the patch applies wholesale, inferred from the patch itself.
 *
 * Part of the wire contract rather than an internal shape, because the number
 * a reviewer wants — how much of this patch the rename accounts for — is only
 * useful if a dashboard can read it too.
 */
export interface Rename {
  /** The most frequent casing, which is what the headline says. */
  from: string;
  to: string;
  /** Casing variants folded into this one rename. */
  casings: number;
  files: number;
  count: number;
}

export const RULE_IDS = [
  'TEST_REMOVED',
  'TEST_SKIPPED_ADDED',
  'ASSERTION_REMOVED',
  'ASSERTION_WEAKENED',
  'ASSERTION_NARROWED',
  'PREDICATE_NARROWED',
  'EXPECTED_VALUE_CHANGED',
  'SNAPSHOT_UPDATED_WITH_CODE',
  'COVERAGE_THRESHOLD_LOWERED',
  'TEST_TIMEOUT_RAISED',
  'TEST_AND_IMPL_TOGETHER',
  'TEST_GATE_DISABLED',
  'SUITE_SCOPE_NARROWED',
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
   * Stable within a patch: `<rule>:<file>:<line>`, or `<rule>:<file>` when the
   * finding is about the file rather than a line in it. Deduplicates a finding
   * that two runs of the same check would both report, and gives the ledger
   * something to join on.
   */
  id: string;
  rule: RuleId;
  severity: Severity;
  file: string;
  /**
   * 1-indexed, in the post-image for additions and the pre-image for removals.
   *
   * Null when the finding is about the file as a whole and no line could
   * honestly be pointed at — a deleted test file has no line 1 to go and look
   * at, and reporting one sends a reviewer to a file that is not there. It is
   * also what makes such a finding suppressable: the key is the path.
   */
  line: number | null;
  /**
   * The named thing inside the file this finding is about — a test case title,
   * most often — when the rule can name one.
   *
   * It exists so an acknowledgement can be as narrow as the finding. A file
   * where fifteen cases were ported and two were not is one file and seventeen
   * findings, and a directive that can only name the file cannot say which two
   * are the ones nobody has explained yet.
   */
  subject?: string;
  message: string;
  evidence: Evidence;
  fix_hint: string;
  /**
   * What else in the patch accounts for this change, when something does.
   *
   * A mass rename makes every line it touches look edited, and a formatter
   * re-wrapping a line that got shorter does the same. Both are true findings
   * and neither is what a reviewer is looking for, so they are marked rather
   * than dropped: the inference is a heuristic, and a heuristic that removed
   * findings on its own would be a way to launder a real edit through a big
   * enough rename.
   */
  explained_by?: string;
}

export interface Report {
  /** Schema version of this payload, independent of the package version. */
  schema: 1;
  ok: boolean;
  /** The git range actually analysed, as resolved — never the literal `auto`. */
  base: string;
  /**
   * The threshold `ok` was decided against. Reported so that a consumer showing
   * "findings at or above X" reads X from the run rather than from its own idea
   * of the default, which is how two surfaces come to disagree in public.
   */
  fail_on: Severity | 'none';
  /**
   * How much that range covered. Present whenever the report came from a run
   * against a repository; absent when `analyze` was handed a diff directly,
   * which has no repository to count against.
   *
   * A clean verdict is the same sentence whether 83 files were examined or
   * none, so without this there is no way to tell a passing patch from a patch
   * that was never read.
   */
  scope?: { files: number; commits: number };
  findings: Finding[];
  counts: Record<Severity, number>;
  /**
   * Findings an `overlock-ignore` comment silenced. Reported rather than simply
   * dropped: an escape hatch nobody can count is one that quietly empties the
   * gate, and this number is what makes a rising suppression rate visible.
   */
  suppressed: number;
  /**
   * Of those, the ones this patch introduced.
   *
   * A directive already in the tree records a decision somebody made. One added
   * by the same patch it silences is the agent writing its own permission slip,
   * and the Stop hook stops once for it.
   */
  suppressed_new: number;
  /**
   * Substitutions the patch applies wholesale, inferred from the patch itself.
   *
   * Reported so that the answer to "what changed that the rename does not
   * explain?" is a number rather than an exercise for the reviewer.
   */
  renames: Rename[];
  /** Findings a rename or a reformat accounts for. Never subtracted from `ok`. */
  explained: number;
  /**
   * Findings dropped because their rule is graded `off`.
   *
   * Counted for the same reason suppressions are: a repository that has judged
   * a rule pure noise is entitled to switch it off, and nobody is entitled to a
   * gate that empties quietly. This is the number that says how much of the
   * patch the run declined to look at.
   */
  silenced: number;
  /**
   * Patch-level acknowledgements read from the commit messages in the range,
   * and from the pull request body when the caller supplies it.
   *
   * The inline directive is the right shape for a finding about a line. It is
   * the wrong shape for a rename touching six hundred files, where using it
   * means adding twenty comments to source files and deleting them again —
   * worse than the noise it silences. This is the proportionate form: one
   * written reason, in the artifact the reviewer is already reading.
   */
  allowed: { rule: RuleId; target: string | null; reason: string }[];
  /**
   * Acknowledgements that silenced nothing.
   *
   * An allowance is a claim about a specific finding — "this case was ported
   * there". When the finding it names is not in the patch, the claim is stale:
   * either the case came back, or it never landed where the trailer said it
   * did. A directive that matches nothing and says nothing is how a list of
   * acknowledgements outlives the refactor it was written for.
   */
  allowances_unused: { rule: RuleId; target: string | null; reason: string }[];
  /** What the new directives claimed, so a human can judge the claim. */
  suppressions_new: {
    rule: RuleId;
    file: string;
    line: number;
    /** The path the directive named, when it named one. */
    target: string | null;
    reason: string;
  }[];
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
