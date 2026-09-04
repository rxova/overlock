import type { DiffFile, Finding, RuleId, Severity } from '../types.js';

export interface RuleContext {
  files: DiffFile[];
  /** Path-based test detection, with any `--test-glob` patterns folded in. */
  isTest: (path: string) => boolean;
}

export interface Rule {
  rule: RuleId;
  run: (ctx: RuleContext) => Finding[];
}

/**
 * Evidence and messages are built from diff content, and diff content is
 * written by whatever produced the patch. They are printed to a terminal,
 * handed to an agent, and pasted into pull request comments — so a test name
 * carrying an erase-line sequence can rewrite the verdict printed above it, and
 * a minified line can carry 400KB into an agent's context window.
 *
 * Both are cut off here, at the one place every finding is built.
 */
const MAX_TEXT = 1000;

export function sanitize(text: string): string {
  // eslint-disable-next-line no-control-regex -- stripping control characters is the point
  const stripped = text.replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, '');
  return stripped.length <= MAX_TEXT ? stripped : `${stripped.slice(0, MAX_TEXT)}...`;
}

/**
 * Blanks the contents of string literals, keeping the quotes.
 *
 * A marker inside quotes is data, not a directive: a fixture asserting on
 * `"it.skip(...)"`, a lint rule naming the pattern it bans, a doc line showing
 * how to write a suppression. Every one of those is a false positive, and on a
 * blocking rule a false positive is how the tool gets uninstalled.
 */
export function withoutStringContents(text: string): string {
  return text.replace(/(['"`])(?:\\.|(?!\1)[^\\])*\1/g, '$1$1');
}

/**
 * Paths are rendered into markdown code spans in pull request comments, so a
 * backtick closes the span and a newline ends the row and begins one the
 * attacker writes. Neither belongs in a path this tool reports.
 */
export function sanitizePath(path: string): string {
  // eslint-disable-next-line no-control-regex -- stripping control characters is the point
  const stripped = path.replace(/[\u0000-\u001F\u007F`]/g, '');
  return stripped.length <= MAX_TEXT ? stripped : `...${stripped.slice(-MAX_TEXT)}`;
}

export function finding(input: {
  rule: RuleId;
  severity: Severity;
  file: string;
  /** Null for a finding about the file itself, which then keys on the path. */
  line: number | null;
  message: string;
  fix_hint: string;
  before?: string;
  after?: string;
}): Finding {
  const evidence: Finding['evidence'] = {};
  if (input.before !== undefined) evidence.before = sanitize(input.before.trim());
  if (input.after !== undefined) evidence.after = sanitize(input.after.trim());

  const path = sanitizePath(input.file);

  return {
    id: input.line === null ? `${input.rule}:${path}` : `${input.rule}:${path}:${input.line}`,
    rule: input.rule,
    severity: input.severity,
    file: path,
    line: input.line,
    message: sanitize(input.message),
    evidence,
    fix_hint: input.fix_hint,
  };
}

/**
 * Tokens that mean "this line asserts something". Wide on purpose: a false
 * positive here costs a `medium` finding a human glances at, while a miss is
 * the whole failure mode the tool exists to catch.
 */
export const ASSERTION_TOKENS: RegExp[] = [
  /\bexpect\s*\(/,
  /\bassert[A-Za-z_]*\s*\(/,
  /\bassert\s+/,
  /\.should\b/,
  /\bshould\s*\(/,
  /\bXCTAssert\w*\s*\(/,
  /\brequire\.\w+\s*\(/, // testify
  /\bt\.(Error|Fatal|Errorf|Fatalf)\s*\(/, // Go's assertion-by-hand
  /\bassert_\w+\s*\(/, // rspec / minitest / pytest plugins
  /\bexpect\s*\{/,
] as const as RegExp[];

export function countAssertions(text: string): number {
  return ASSERTION_TOKENS.reduce((total, re) => {
    const global = new RegExp(re.source, 'g');
    return total + (text.match(global)?.length ?? 0);
  }, 0);
}

export function looksLikeAssertion(text: string): boolean {
  return ASSERTION_TOKENS.some((re) => re.test(text));
}

/** The subject of an `expect(...)` call, used to pair a removal with an addition. */
export function expectSubject(text: string): string | null {
  const m = /\bexpect\s*\(([^)]*)\)/.exec(text);
  return m?.[1]?.trim() ?? null;
}

/** Numeric and string literals, replaced by a placeholder, for shape comparison. */
export function normalizeLiterals(text: string): string {
  return text
    .replace(/(['"`])(?:\\.|(?!\1)[^\\])*\1/g, '<lit>')
    .replace(/\b\d+(?:\.\d+)?\b/g, '<num>')
    .replace(/\s+/g, ' ')
    .trim();
}

export function literalsOf(text: string): string[] {
  const strings = text.match(/(['"`])(?:\\.|(?!\1)[^\\])*\1/g) ?? [];
  const numbers = text.match(/\b\d+(?:\.\d+)?\b/g) ?? [];
  return [...strings, ...numbers];
}

/** Files this patch changed that are neither tests, snapshots nor config. */
export function productionFiles(ctx: RuleContext): DiffFile[] {
  return ctx.files.filter(
    (f) =>
      !ctx.isTest(f.path) &&
      !/\.snap$|__snapshots__\//.test(f.path) &&
      !/\.(md|txt|json|ya?ml|toml|lock)$/.test(f.path) &&
      !/\.config\.[cm]?[jt]s$/.test(f.path),
  );
}
