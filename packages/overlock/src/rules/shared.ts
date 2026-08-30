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

export function finding(input: {
  rule: RuleId;
  severity: Severity;
  file: string;
  line: number;
  message: string;
  fix_hint: string;
  before?: string;
  after?: string;
}): Finding {
  const evidence: Finding['evidence'] = {};
  if (input.before !== undefined) evidence.before = input.before.trim();
  if (input.after !== undefined) evidence.after = input.after.trim();

  return {
    id: `${input.rule}:${input.file}:${input.line}`,
    rule: input.rule,
    severity: input.severity,
    file: input.file,
    line: input.line,
    message: input.message,
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
