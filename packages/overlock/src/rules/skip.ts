import { addedLines } from '../diff.js';
import type { Finding } from '../types.js';
import { finding, type Rule, type RuleContext } from './shared.js';

interface SkipPattern {
  re: RegExp;
  label: string;
  /** True when the marker silences other tests rather than this one. */
  exclusive?: boolean;
  /**
   * Extensions this marker is meaningful in, for languages that put tests in
   * ordinary source files. Absent means "any file the path rules call a test".
   */
  extensions?: string[];
}

const SKIP_PATTERNS: SkipPattern[] = [
  { re: /\b(?:it|test|describe|context|suite)\s*\.\s*skip\b/, label: '.skip' },
  { re: /\b(?:it|test|describe|context|suite)\s*\.\s*todo\b/, label: '.todo' },
  { re: /\bx(?:it|test|describe|context)\s*\(/, label: 'x-prefixed declaration' },
  { re: /\bpending\s*\(/, label: 'pending()' },
  // `.only` is the inverse trick and a worse one: it does not skip this test,
  // it skips every other test in the file. Committed, it is never intentional.
  { re: /\b(?:it|test|describe|context|suite)\s*\.\s*only\b/, label: '.only', exclusive: true },
  { re: /\bfit\s*\(|\bfdescribe\s*\(/, label: 'f-prefixed declaration', exclusive: true },
  { re: /@pytest\.mark\.skip/, label: '@pytest.mark.skip' },
  { re: /@pytest\.mark\.xfail/, label: '@pytest.mark.xfail' },
  { re: /@(?:unittest\.)?skip(?:If|Unless)?\b/, label: '@skip' },
  { re: /\bpytest\.skip\s*\(/, label: 'pytest.skip()' },
  // Go, Rust, JVM and .NET keep tests in ordinary source files, so these are not
  // gated on the path looking like a test — but they ARE gated on the language.
  // Without that, a markdown table listing the markers, or a linter rule that
  // matches them, reads as tampering. That is not hypothetical: it is the first
  // thing this tool reported when run against its own repository.
  { re: /\bt\.Skip(?:Now|f)?\s*\(/, label: 't.Skip()', extensions: ['.go'] },
  { re: /#!?\[ignore\]/, label: '#[ignore]', extensions: ['.rs'] },
  { re: /@(?:Disabled|Ignore)\b/, label: '@Disabled', extensions: ['.java', '.kt', '.kts'] },
  { re: /\[(?:Ignore|Skip)\]/, label: '[Ignore]', extensions: ['.cs', '.fs'] },
];

/**
 * A comment is not a skip. Without this, adding the line
 * `// we used to it.skip this` reads as tampering.
 *
 * `#` opens a comment in Python, Ruby and YAML but opens an *attribute* in
 * Rust, so `#[ignore]` and `#![ignore]` are excluded from the comment test —
 * they are the marker, not a note about it.
 */
function isCommented(text: string): boolean {
  return /^\s*(?:\/\/|#(?!!?\[)|\*|\/\*)/.test(text);
}

/**
 * Blanks the contents of string literals before matching.
 *
 * A marker inside quotes is data, not a directive: a test fixture asserting on
 * `"it.skip(...)"`, a lint rule naming the pattern it bans, a message that
 * mentions it. Every one of those is a false positive, and a false positive on
 * a `high` rule is how a blocking hook gets uninstalled.
 *
 * The quotes themselves are kept so a real marker survives the blanking —
 * `it.skip('rejects', fn)` becomes `it.skip('', fn)` and still matches.
 */
function withoutStringContents(text: string): string {
  return text.replace(/(['"`])(?:\\.|(?!\1)[^\\])*\1/g, '$1$1');
}

function extensionOf(path: string): string {
  const base = path.slice(path.lastIndexOf('/') + 1);
  const dot = base.lastIndexOf('.');
  return dot === -1 ? '' : base.slice(dot);
}

export const testSkippedAdded: Rule = {
  rule: 'TEST_SKIPPED_ADDED',
  run(ctx: RuleContext): Finding[] {
    const findings: Finding[] = [];

    for (const file of ctx.files) {
      if (file.status === 'deleted') continue;
      const inTestFile = ctx.isTest(file.path);
      const extension = extensionOf(file.path);

      for (const line of addedLines(file)) {
        if (isCommented(line.text)) continue;
        const code = withoutStringContents(line.text);

        for (const pattern of SKIP_PATTERNS) {
          if (pattern.extensions) {
            if (!pattern.extensions.includes(extension)) continue;
          } else if (!inTestFile) {
            continue;
          }

          if (!pattern.re.test(code)) continue;

          findings.push(
            finding({
              rule: 'TEST_SKIPPED_ADDED',
              severity: 'high',
              file: file.path,
              /* c8 ignore next -- an added line always carries a post-image number */
              line: line.newLine ?? 1,
              message: pattern.exclusive
                ? `${pattern.label} added — this silences every other test in the file.`
                : `${pattern.label} added — this test no longer runs.`,
              after: line.text,
              fix_hint: pattern.exclusive
                ? `Remove ${pattern.label} so the rest of the file runs again.`
                : 'Make the test pass, or delete it deliberately and say why.',
            }),
          );
          break;
        }
      }
    }

    return findings;
  },
};
