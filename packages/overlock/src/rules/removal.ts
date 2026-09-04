import { addedLines, removedLines } from '../diff.js';
import { sourceSubject, testSubject } from '../paths.js';
import type { DiffFile, Finding } from '../types.js';
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

function declaredNames(lines: { text: string }[]): string[] {
  const names: string[] = [];
  for (const line of lines) {
    const name = declaredName(line.text);
    if (name !== null && !names.includes(name)) names.push(name);
  }
  return names;
}

/**
 * Every case name this patch adds, anywhere in it.
 *
 * Patch-global rather than per-file, because the move this rule most needs to
 * understand — splitting one test file into six, or re-homing cases before
 * deleting the file they lived in — is invisible to a per-file view. The file
 * that lost the case and the file that gained it are different files.
 *
 * It is a heuristic and the README says so: a renamed case reads as vanished,
 * and a same-named case that now asserts nothing reads as re-homed. It grades
 * severity and names what to go and look at; it does not replace the reviewer.
 */
function survivingNames(ctx: RuleContext): Set<string> {
  const names = new Set<string>();
  for (const file of ctx.files) {
    if (file.status === 'deleted' || !ctx.isTest(file.path)) continue;
    for (const name of declaredNames(addedLines(file))) names.add(name);
  }
  return names;
}

/**
 * True when the patch also deletes the implementation this test file is named
 * after: `api.test.ts` alongside `api.ts`.
 *
 * Deleting a feature deletes its tests, and that is not test tampering. It is
 * the one signal here that is a fact about the patch rather than a guess about
 * names, so it grades down on its own. Note that it deliberately does not fire
 * when the subject was merely *modified* — a test file deleted while the code
 * it covered lives on is exactly the case worth stopping for.
 */
function subjectAlsoDeleted(file: DiffFile, ctx: RuleContext): string | null {
  const subject = testSubject(file.path);
  if (subject === null) return null;

  for (const other of ctx.files) {
    if (other.status !== 'deleted' || ctx.isTest(other.path)) continue;
    if (sourceSubject(other.path) === subject) return other.path;
  }
  return null;
}

/** At most a handful of names, so one finding cannot become the whole report. */
const MAX_NAMES = 5;

function listNames(names: string[]): string {
  const shown = names.slice(0, MAX_NAMES).join(', ');
  const hidden = names.length - Math.min(names.length, MAX_NAMES);
  return hidden > 0 ? `${shown}, and ${hidden} more` : shown;
}

const DELETION_HINT =
  'Move the missing cases into a file the runner collects, or record the decision where ' +
  'overlock reads it: `overlock-ignore TEST_REMOVED <path> -- <reason>`. Saying it in the ' +
  'commit message or description explains it to a reviewer, but nothing reads that.';

/**
 * What a deleted test file amounts to, given everything else in the patch.
 *
 * The question a reviewer is actually asking is not "was a test file deleted"
 * — they can see that in the file list — but "did any coverage go with it".
 * So the cases are counted: all of them re-homed is a refactor, some of them
 * gone is the thing to go and look at, and the ones that went are named.
 */
function deletedFile(file: DiffFile, ctx: RuleContext, surviving: Set<string>): Finding {
  const base = {
    rule: 'TEST_REMOVED',
    file: file.path,
    line: null,
    fix_hint: DELETION_HINT,
  } as const;

  const deletedSubject = subjectAlsoDeleted(file, ctx);
  if (deletedSubject !== null) {
    return finding({
      ...base,
      severity: 'medium',
      message: `Test file deleted, along with the module it covers (${deletedSubject}).`,
    });
  }

  const removed = declaredNames(removedLines(file));
  const vanished = removed.filter((name) => !surviving.has(name));

  // No recognisable case declarations: an unparsed language, or a file whose
  // contents the diff does not carry. Nothing was measured, so nothing is
  // graded down.
  if (removed.length === 0) {
    return finding({ ...base, severity: 'high', message: 'Test file deleted.' });
  }

  if (vanished.length === 0) {
    return finding({
      ...base,
      severity: 'medium',
      message: `Test file deleted — all ${removed.length} of its cases reappear elsewhere in this patch.`,
    });
  }

  const rehomed = removed.length - vanished.length;
  const preamble =
    rehomed > 0
      ? `Test file deleted — ${rehomed} of ${removed.length} cases reappear elsewhere in this patch. ${vanished.length} did not`
      : `Test file deleted — none of its ${removed.length} cases appear elsewhere in this patch`;

  return finding({
    ...base,
    severity: 'high',
    message: `${preamble}: ${listNames(vanished)}`,
  });
}

export const testRemoved: Rule = {
  rule: 'TEST_REMOVED',
  run(ctx: RuleContext): Finding[] {
    const findings: Finding[] = [];
    const surviving = survivingNames(ctx);

    for (const file of ctx.files) {
      if (file.status === 'deleted' && ctx.isTest(file.path)) {
        findings.push(deletedFile(file, ctx, surviving));
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
              line: null,
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

      for (const line of removedLines(file)) {
        const name = declaredName(line.text);
        if (!name || surviving.has(name)) continue;

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
