import { addedLines, removedLines } from '../diff.js';
import type { Finding } from '../types.js';
import { finding, type Rule, type RuleContext } from './shared.js';

/**
 * Declarations that introduce a test case, per language. The captured group is
 * the case's name, which is what makes a removal distinguishable from a rename
 * or a reindent: the same name appearing on an added line means the case
 * survived.
 */
const DECLARATIONS: RegExp[] = [
  /\b(?:it|test)\s*(?:\.\w+)?\s*\(\s*(['"`])(.+?)\1/,
  /^\s*(?:async\s+)?def\s+(test_\w+)\s*\(/,
  /^\s*func\s+(Test\w+)\s*\(/,
  /^\s*(?:public\s+)?(?:void\s+)?(?:fun\s+)?(test\w+)\s*\(\s*\)/,
];

function declaredName(text: string): string | null {
  for (const re of DECLARATIONS) {
    const m = re.exec(text);
    if (!m) continue;
    // Either group 2 (quoted title) or group 1 (identifier), whichever matched.
    const name = m[2] ?? m[1];
    if (name) return name.trim();
  }
  return null;
}

export const testRemoved: Rule = {
  rule: 'TEST_REMOVED',
  run(ctx: RuleContext): Finding[] {
    const findings: Finding[] = [];

    for (const file of ctx.files) {
      if (file.status === 'deleted' && ctx.isTest(file.path)) {
        findings.push(
          finding({
            rule: 'TEST_REMOVED',
            severity: 'high',
            file: file.path,
            line: 1,
            message: 'Test file deleted.',
            fix_hint:
              'Restore the file, or say in the commit message why these cases no longer apply.',
          }),
        );
        continue;
      }

      // A rename out of the runner's glob deletes the tests without deleting
      // the file, which is why this is checked separately and at the same
      // severity: `login.test.ts` becoming `login.helpers.ts` stops it running.
      if (file.status === 'renamed' && file.oldPath && ctx.isTest(file.oldPath)) {
        if (!ctx.isTest(file.path)) {
          findings.push(
            finding({
              rule: 'TEST_REMOVED',
              severity: 'high',
              file: file.path,
              line: 1,
              message: `Test file renamed out of the test glob (was ${file.oldPath}).`,
              before: file.oldPath,
              after: file.path,
              fix_hint: 'Rename it back, or move the cases into a file the runner still collects.',
            }),
          );
          continue;
        }
      }

      if (file.status === 'deleted' || !ctx.isTest(file.path)) continue;

      const survivingNames = new Set(
        addedLines(file)
          .map((l) => declaredName(l.text))
          .filter((n): n is string => n !== null),
      );

      for (const line of removedLines(file)) {
        const name = declaredName(line.text);
        if (!name || survivingNames.has(name)) continue;

        findings.push(
          finding({
            rule: 'TEST_REMOVED',
            severity: 'medium',
            file: file.path,
            line: line.oldLine ?? 1,
            message: `Test case removed: ${name}`,
            before: line.text,
            fix_hint: 'Put the case back, or replace it with one that covers the same behaviour.',
          }),
        );
      }
    }

    return findings;
  },
};
