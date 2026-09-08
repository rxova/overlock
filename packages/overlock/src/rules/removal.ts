import { addedLines, removedLines } from '../diff.js';
import { sourceSubject, testSubject } from '../paths.js';
import type { DiffFile, Finding } from '../types.js';
import { bodies, declaredName, isSameCase, type CaseBody } from './cases.js';
import { finding, type Rule, type RuleContext } from './shared.js';

/**
 * Every case this patch declares on an added line, with the file it landed in.
 *
 * Patch-global rather than per-file, because the move this rule most needs to
 * understand — splitting one test file into six, or re-homing cases before
 * deleting the file they lived in — is invisible to a per-file view. The file
 * that lost the case and the file that gained it are different files.
 */
interface Arrival {
  path: string;
  body: CaseBody;
}

function arrivals(ctx: RuleContext): Arrival[] {
  const found: Arrival[] = [];
  for (const file of ctx.files) {
    if (file.status === 'deleted' || !ctx.isTest(file.path)) continue;
    for (const body of bodies(addedLines(file))) found.push({ path: file.path, body });
  }
  return found;
}

/**
 * Where a removed case reappears, or null when it does not.
 *
 * Three ways of asking, in descending order of confidence. Its own title is the
 * first: an exact match is not a guess. Its title with the patch's inferred
 * rename applied is the second — a rename that sweeps identifiers through a
 * repository sweeps them through test titles too, and `lists ledger entries`
 * becoming `lists admin entries` is the same case, not a deleted one.
 *
 * The body is the third and the one that matters most in practice: every
 * TEST_REMOVED finding in one reported patch was a rename whose body had
 * largely survived. A case is what it asserts, and matching on the title alone
 * reads a retitled test as a deleted one.
 */
function landedIn(removed: CaseBody, ctx: RuleContext, gained: Arrival[]): string | null {
  const renamed = declaredName(ctx.renamed(removed.declaration.text));

  for (const arrival of gained) {
    if (arrival.body.name === removed.name) return arrival.path;
    if (renamed !== null && arrival.body.name === renamed) return arrival.path;
  }
  for (const arrival of gained) {
    if (isSameCase(removed, arrival.body)) return arrival.path;
  }
  return null;
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

/** A file whose every case is accounted for somewhere else in the patch. */
interface Move {
  from: string;
  /** The one file that took the cases, or null when they went to several. */
  to: string | null;
  cases: number;
}

/**
 * The single destination every case went to, or null when they scattered.
 *
 * Naming it is the difference between "these cases exist somewhere in a
 * 40-file patch" and "this spec moved here" — the second is a sentence a
 * reviewer can check in one click.
 */
function soleDestination(landings: string[]): string | null {
  const distinct = [...new Set(landings)];
  return distinct.length === 1 ? (distinct[0] ?? null) : null;
}

type Verdict = { kind: 'moved'; move: Move } | { kind: 'finding'; finding: Finding };

/**
 * What a deleted test file amounts to, given everything else in the patch.
 *
 * The question a reviewer is actually asking is not "was a test file deleted"
 * — they can see that in the file list — but "did any coverage go with it".
 * So the cases are counted: all of them re-homed is a refactor, some of them
 * gone is the thing to go and look at, and the ones that went are named.
 */
function deletedFile(file: DiffFile, ctx: RuleContext, gained: Arrival[]): Verdict {
  const base = {
    rule: 'TEST_REMOVED',
    file: file.path,
    line: null,
    fix_hint: DELETION_HINT,
  } as const;

  const deletedSubject = subjectAlsoDeleted(file, ctx);
  if (deletedSubject !== null) {
    return {
      kind: 'finding',
      finding: finding({
        ...base,
        severity: 'medium',
        message: `Test file deleted, along with the module it covers (${deletedSubject}).`,
      }),
    };
  }

  const removed = bodies(removedLines(file));

  // No recognisable case declarations: an unparsed language, or a file whose
  // contents the diff does not carry. Nothing was measured, so nothing is
  // graded down.
  if (removed.length === 0) {
    return {
      kind: 'finding',
      finding: finding({ ...base, severity: 'high', message: 'Test file deleted.' }),
    };
  }

  const landings = removed.map((c) => ({ case: c, at: landedIn(c, ctx, gained) }));
  const vanished = landings.filter((l) => l.at === null).map((l) => l.case.name);
  const rehomed = landings.filter((l): l is { case: CaseBody; at: string } => l.at !== null);

  if (vanished.length === 0) {
    return {
      kind: 'moved',
      move: {
        from: file.path,
        to: soleDestination(rehomed.map((l) => l.at)),
        cases: removed.length,
      },
    };
  }

  const destination = soleDestination(rehomed.map((l) => l.at));
  const where = destination === null ? 'elsewhere in this patch' : `in ${destination}`;
  const preamble =
    rehomed.length > 0
      ? `Test file deleted — ${rehomed.length} of ${removed.length} cases reappear ${where}. ${vanished.length} did not`
      : `Test file deleted — none of its ${removed.length} cases appear elsewhere in this patch`;

  return {
    kind: 'finding',
    finding: finding({
      ...base,
      severity: 'high',
      message: `${preamble}: ${listNames(vanished)}`,
    }),
  };
}

function describeMove(move: Move): string {
  return move.to === null ? `${move.from} -> (several files)` : `${move.from} -> ${move.to}`;
}

/**
 * Moved spec files, as one finding rather than one each.
 *
 * A refactor that re-homes eight spec files is one decision. Reported per file
 * it is eight findings needing eight acknowledgements, which is the difference
 * between explaining a refactor once and rubber-stamping it eight times — and a
 * reviewer who has rubber-stamped six is not reading the seventh.
 *
 * It stays `medium` and it stays reported. Every case was found again, but
 * "found again" is a match on a title or a body, not a promise that the case
 * still asserts what it did.
 */
function movedFiles(moves: Move[]): Finding {
  const first = moves[0] as Move;
  if (moves.length === 1) {
    const where = first.to === null ? 'elsewhere in this patch' : `in ${first.to}`;
    return finding({
      rule: 'TEST_REMOVED',
      severity: 'medium',
      file: first.from,
      line: null,
      message: `Test file deleted — all ${first.cases} of its cases reappear ${where}.`,
      fix_hint: DELETION_HINT,
    });
  }

  const cases = moves.reduce((total, m) => total + m.cases, 0);
  return finding({
    rule: 'TEST_REMOVED',
    severity: 'medium',
    file: first.from,
    line: null,
    message:
      `${moves.length} test files deleted — all ${cases} of their cases reappear elsewhere ` +
      `in this patch: ${listNames(moves.map(describeMove))}`,
    fix_hint:
      `One acknowledgement covers the set: \`overlock-ignore TEST_REMOVED ${first.from} -- <reason>\`, ` +
      'or `Overlock-Allow: TEST_REMOVED -- <reason>` in the commit message. Read one of the ' +
      'destination files first — a case that was found again by name is not a case that still asserts what it did.',
  });
}

export const testRemoved: Rule = {
  rule: 'TEST_REMOVED',
  run(ctx: RuleContext): Finding[] {
    const findings: Finding[] = [];
    const gained = arrivals(ctx);
    const moves: Move[] = [];

    for (const file of ctx.files) {
      if (file.status === 'deleted' && ctx.isTest(file.path)) {
        const verdict = deletedFile(file, ctx, gained);
        if (verdict.kind === 'moved') moves.push(verdict.move);
        else findings.push(verdict.finding);
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

      for (const removed of bodies(removedLines(file))) {
        if (landedIn(removed, ctx, gained) !== null) continue;

        findings.push(
          finding({
            rule: 'TEST_REMOVED',
            severity: 'medium',
            file: file.path,
            line: removed.declaration.oldLine ?? 1,
            // Named so an acknowledgement can cover this case and no other:
            // fifteen ported cases and two that were not is a distinction a
            // file-wide directive cannot make.
            subject: removed.name,
            message: `Test case removed: ${removed.name}`,
            before: removed.declaration.text,
            fix_hint: 'Put the case back, or replace it with one that covers the same behaviour.',
          }),
        );
      }
    }

    if (moves.length > 0) findings.push(movedFiles(moves));

    return findings;
  },
};
