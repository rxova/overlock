import { addedLines, changeBlocks, removedLines } from '../diff.js';
import type { DiffFile, DiffLine, Finding, Severity } from '../types.js';
import { byCase, squash, type CaseDelta } from './cases.js';
import {
  countAssertions,
  expectSubject,
  finding,
  literalsOf,
  looksLikeAssertion,
  normalizeLiterals,
  type Rule,
  type RuleContext,
} from './shared.js';

/**
 * Matchers that pin a value down.
 *
 * `toBeNull()`, `toBeUndefined()` and `assertIsNone()` are here rather than in
 * the loose family below, and that placement is the whole distinction: each one
 * names exactly one value, the same way `toBe(false)` does. Reading them as
 * existence checks made `expect(session).toBe(x)` becoming
 * `expect(session).toBeNull()` — a *stronger* claim about the value — report as
 * a weakened assertion.
 */
const EXACT =
  /\b(?:toBe|toEqual|toStrictEqual|toMatchObject|toHaveBeenCalledWith|assertEqual|assertEquals|toContain|toHaveLength|toBeNull|toBeUndefined|assertIsNone)\s*\(/;

/** `expect(x).not.toBe(...)`, `expect(x).resolves.not.toBeNull()`, `.to.not.be`. */
const NEGATED = /\.\s*not\s*\./;

/** The null family, whose meaning inverts under negation. */
const NULLISH = /\b(?:toBeNull|toBeUndefined)\s*\(/;

/** A placeholder standing in for a value: `expect.any(Number)`, `expect.anything()`. */
const PLACEHOLDER = /\bexpect\s*\.\s*any(?:thing)?\s*\(/;

/**
 * Matchers that give the value up, and what each one still checks.
 *
 * The phrase is printed in the finding, so the message says what the
 * replacement actually asserts rather than calling every one of them an
 * existence check. The existence family proper is three members wide —
 * `toBeDefined`, `toBeTruthy` and `not.toBeNull` — and this list is the rest of
 * the ways an assertion stops naming a value, kept separate from them.
 */
const LOOSE: { re: RegExp; checks: string }[] = [
  { re: /\b(?:toBeDefined|assertIsNotNone)\s*\(/, checks: 'that a value is present' },
  { re: /\b(?:toBeTruthy|assertTrue)\s*\(/, checks: 'that a value is truthy' },
  { re: /\btoBeFalsy\s*\(/, checks: 'that a value is falsy' },
  { re: /\btoBeInstanceOf\s*\(/, checks: 'the type' },
  { re: /\btoHaveBeenCalled\s*\(/, checks: 'that it was called at all' },
  { re: PLACEHOLDER, checks: 'the type' },
];

/** Whether an assertion still names the value it expects. */
function isExact(text: string): boolean {
  if (NEGATED.test(text)) {
    // `not.toBeDefined()` is `toBeUndefined()` written the long way round, and
    // a negated exact matcher still rules out a named value.
    if (/\btoBeDefined\s*\(/.test(text)) return true;
    if (NULLISH.test(text)) return false;
  }
  return EXACT.test(text);
}

/**
 * What an assertion still checks once it no longer names a value, or null when
 * it does still name one.
 */
function looseness(text: string): string | null {
  if (NEGATED.test(text)) {
    // The third member of the existence family: `not.toBeNull()` says a value
    // is there and nothing at all about what it is. Every other negated matcher
    // is left alone — `not.toBeTruthy()` is neither exact nor an existence
    // check, and guessing which is how this rule got too wide in the first place.
    return NULLISH.test(text) ? 'that a value is present' : null;
  }
  for (const m of LOOSE) if (m.re.test(text)) return m.checks;
  return null;
}

/**
 * What the replacement gave up, or null when it gave up nothing.
 *
 * `toHaveBeenCalledWith(expect.any(Number))` is exact in form and loose in
 * substance, so it counts — but only when the line it replaced did not already
 * use a placeholder. Otherwise adding a field to an existing `expect.any({...})`
 * object reads as a weakening, which it is not.
 */
function loosens(before: string, after: string): string | null {
  const checks = looseness(after);
  if (checks === null) return null;
  if (!isExact(after)) return checks;
  return PLACEHOLDER.test(after) && !PLACEHOLDER.test(before) ? checks : null;
}

/**
 * Every line the file ends the patch with that the patch did not delete —
 * additions and context both.
 *
 * An assertion that is removed here and added there is a move, and a move is
 * the shape a reviewer is least willing to see reported as a weakening: the
 * strict assertion is still standing, one screen further down. Comparing
 * against the post-image is what tells the two apart.
 */
function postImage(file: DiffFile, renamed: (text: string) => string): Set<string> {
  const kept = new Set<string>();
  for (const hunk of file.hunks) {
    for (const line of hunk.lines) {
      if (line.kind === 'del') continue;
      kept.add(squash(line.text));
      // A removal is compared under the patch's inferred rename, so the
      // post-image has to be readable on the same terms.
      kept.add(squash(renamed(line.text)));
    }
  }
  return kept;
}

/** `user` -> `user.role`, `rows` -> `rows[0]`: the same subject, a part of it. */
function narrows(subject: string, target: string): boolean {
  return target.startsWith(`${subject}.`) || target.startsWith(`${subject}[`);
}

/**
 * Whether the replacement checks fewer values than the assertion it replaced.
 *
 * Both counts and the requirement that the replacement still name a literal are
 * what keep this off the commonest innocent edit of all: lifting an expectation
 * into a variable — `toEqual({ a: 1, b: 2 })` becoming `toEqual(expected)` —
 * checks exactly as much as it did before, and reads as a narrowing to anything
 * that only counts what it can see.
 */
function checksFewerValues(before: string, after: string): boolean {
  const wanted = literalsOf(after).length;
  if (wanted === 0 || wanted >= literalsOf(before).length) return false;
  // Same shape, different literal, is EXPECTED_VALUE_CHANGED's finding.
  return normalizeLiterals(after) !== normalizeLiterals(before);
}

/** What a replacement gave up, in the terms the finding is written in. */
type Verdict =
  | { rule: 'ASSERTION_WEAKENED'; message: string; fix_hint: string }
  | { rule: 'ASSERTION_NARROWED'; message: string; fix_hint: string };

const WEAKENED_HINT = 'Assert the value, not that a value is present.';
const NARROWED_HINT =
  'Keep the assertion that covered the whole thing, or say what now covers the rest of it.';

/**
 * The first unclaimed addition that answers for this removal, and what it gave up.
 *
 * Claimed rather than merely found, so one added assertion cannot be reported
 * as the answer to two different removals.
 *
 * Two distinct things can have happened, and telling them apart is the point:
 * the assertion stopped naming a value, or it kept naming one and stopped
 * covering as much. A patch that swaps `toEqual({ id, status, lapsedAt })` for
 * `expect(row.lapsedAt).toBeNull()` did the second — reporting it as the first
 * is a true finding with a false reason, which costs a reader more than silence
 * would, because they have to work out the real one before they can act.
 */
function answerFor(
  adds: DiffLine[],
  claimed: Set<number>,
  subject: string,
  before: string,
): { index: number; line: DiffLine; verdict: Verdict } | null {
  for (const [index, line] of adds.entries()) {
    if (claimed.has(index)) continue;
    const target = expectSubject(line.text);
    if (target === null) continue;

    if (target === subject) {
      const checks = loosens(before, line.text);
      if (checks !== null) {
        return {
          index,
          line,
          verdict: {
            rule: 'ASSERTION_WEAKENED',
            message: `An exact assertion was replaced with one that only checks ${checks}.`,
            fix_hint: WEAKENED_HINT,
          },
        };
      }
      if (isExact(line.text) && checksFewerValues(before, line.text)) {
        return {
          index,
          line,
          verdict: {
            rule: 'ASSERTION_NARROWED',
            message:
              `Assertion narrowed: ${literalsOf(before).length} expected values checked, ` +
              `now ${literalsOf(line.text).length}.`,
            fix_hint: NARROWED_HINT,
          },
        };
      }
      continue;
    }

    if (narrows(subject, target) && looksLikeAssertion(line.text)) {
      return {
        index,
        line,
        verdict: {
          rule: 'ASSERTION_NARROWED',
          message: `Assertion narrowed: ${subject} was checked as a whole, now only ${target}.`,
          fix_hint: NARROWED_HINT,
        },
      };
    }
  }
  return null;
}

/**
 * Every changed line in the file, mapped to the case it sits in.
 *
 * Built once per file so that a finding about a line can be graded by the test
 * around it. Declarations are not in it and do not need to be: no rule here
 * reports one.
 */
function casesAround(file: DiffFile): Map<DiffLine, CaseDelta> {
  const index = new Map<DiffLine, CaseDelta>();
  for (const delta of byCase(file).values()) {
    for (const line of delta.adds) index.set(line, delta);
    for (const line of delta.dels) index.set(line, delta);
  }
  return index;
}

/** Assertions the case ended the patch with, less the ones it started with. */
function assertionBalance(delta: CaseDelta): number {
  const gained = delta.adds.reduce((n, l) => n + countAssertions(l.text), 0);
  const lost = delta.dels.reduce((n, l) => n + countAssertions(l.text), 0);
  return gained - lost;
}

/**
 * The same edit read at the scale of the test rather than the line.
 *
 * A line that gives up specificity inside a case that came out of the patch
 * asserting *more* than it did before is a different event from one inside a
 * case that only lost. Both are worth reporting and only the second is worth
 * stopping an agent for, so the balance decides the grade and the message says
 * what the balance was — a reader who disagrees can see the number that led here.
 */
function gradeByCase(
  around: Map<DiffLine, CaseDelta>,
  line: DiffLine,
): { severity: Severity; note: string } {
  const delta = around.get(line);
  const balance = delta === undefined ? 0 : assertionBalance(delta);
  if (balance <= 0) return { severity: 'high', note: '' };
  return {
    severity: 'medium',
    note: ` The case gained ${balance} assertion${balance === 1 ? '' : 's'} overall.`,
  };
}

export const assertionRemoved: Rule = {
  rule: 'ASSERTION_REMOVED',
  run(ctx: RuleContext): Finding[] {
    const findings: Finding[] = [];

    for (const file of ctx.files) {
      // A deleted test file is TEST_REMOVED's finding, not a second one here.
      if (file.status === 'deleted' || !ctx.isTest(file.path)) continue;

      const removed = removedLines(file);
      const before = removed.reduce((n, l) => n + countAssertions(l.text), 0);
      const after = addedLines(file).reduce((n, l) => n + countAssertions(l.text), 0);
      const lost = before - after;
      if (lost <= 0) continue;

      const firstAssertion = removed.find((l) => looksLikeAssertion(l.text));

      findings.push(
        finding({
          rule: 'ASSERTION_REMOVED',
          severity: 'medium',
          file: file.path,
          /* c8 ignore next -- a removed line always carries a pre-image number */
          line: firstAssertion?.oldLine ?? 1,
          message: `${lost} assertion${lost === 1 ? '' : 's'} removed and not replaced.`,
          ...(firstAssertion ? { before: firstAssertion.text } : {}),
          fix_hint:
            'If the behaviour still holds, assert it. If it does not, the test was telling you something.',
        }),
      );
    }

    return findings;
  },
};

/**
 * Two rules, one search.
 *
 * Weakening and narrowing are the same question asked of the same pair — a
 * removal, and the addition that answered for it — and only the answer differs.
 * Searching separately would let one edit satisfy both searches and be reported
 * twice, which is the outcome that matters here: the whole complaint behind
 * `ASSERTION_NARROWED` is a finding arriving with the wrong reason attached, and
 * two reasons is not an improvement on one.
 *
 * Each registered rule filters this to its own verdicts, so the pass runs twice
 * over a patch. That is cheaper than it looks — the work is linear in the diff,
 * which git has already handed us — and it keeps the registry honest: one entry
 * per rule ID, in the order the report reads them.
 */
function looseningFindings(ctx: RuleContext): Finding[] {
  const findings: Finding[] = [];

  for (const file of ctx.files) {
    if (file.status === 'deleted' || !ctx.isTest(file.path)) continue;

    const kept = postImage(file, ctx.renamed);
    const around = casesAround(file);

    for (const hunk of file.hunks) {
      // Per change block rather than per hunk: two edits three context lines
      // apart are one hunk and two different tests, and pairing across them
      // invents a weakening out of a removal here and an addition there.
      for (const block of changeBlocks(hunk)) {
        const adds = block.filter((l) => l.kind === 'add');
        const claimed = new Set<number>();

        for (const del of block) {
          if (del.kind !== 'del') continue;

          // The subject is taken from the renamed pre-image, because the
          // subject is where a rename lands: `expect(warehouserouting.total())`
          // becoming `expect(routing.total()).toBeDefined()` is a weakening
          // whose two halves would otherwise never be seen as a pair.
          const before = ctx.renamed(del.text);
          if (!isExact(before)) continue;

          // Still there, further down the file: the assertion moved.
          if (kept.has(squash(before))) continue;

          // Pairing on the `expect(...)` subject is what keeps this precise:
          // an unrelated strict assertion removed in the same block as an
          // unrelated loose one added is not a weakening.
          const subject = expectSubject(before);
          if (subject === null) continue;

          const pair = answerFor(adds, claimed, subject, before);
          if (pair === null) continue;

          const { line: match, verdict } = pair;
          claimed.add(pair.index);
          const grade = gradeByCase(around, match);

          findings.push(
            finding({
              rule: verdict.rule,
              severity: grade.severity,
              file: file.path,
              /* c8 ignore next -- an added line always carries a post-image number */
              line: match.newLine ?? del.oldLine ?? 1,
              message: `${verdict.message}${grade.note}`,
              before: del.text,
              after: match.text,
              fix_hint: verdict.fix_hint,
            }),
          );
        }
      }
    }
  }

  return findings;
}

export const assertionWeakened: Rule = {
  rule: 'ASSERTION_WEAKENED',
  run: (ctx) => looseningFindings(ctx).filter((f) => f.rule === 'ASSERTION_WEAKENED'),
};

export const assertionNarrowed: Rule = {
  rule: 'ASSERTION_NARROWED',
  run: (ctx) => looseningFindings(ctx).filter((f) => f.rule === 'ASSERTION_NARROWED'),
};

export const expectedValueChanged: Rule = {
  rule: 'EXPECTED_VALUE_CHANGED',
  run(ctx: RuleContext): Finding[] {
    const findings: Finding[] = [];

    for (const file of ctx.files) {
      if (file.status === 'deleted' || !ctx.isTest(file.path)) continue;

      for (const hunk of file.hunks) {
        const dels = hunk.lines.filter((l) => l.kind === 'del' && looksLikeAssertion(l.text));
        const adds = hunk.lines.filter((l) => l.kind === 'add' && looksLikeAssertion(l.text));
        const claimed = new Set<number>();

        for (const del of dels) {
          // Renamed first, for the same reason: a value edited in the same
          // commit that renamed the thing it is read from is still a value
          // edit, and the shapes only match once the rename is applied.
          const shape = normalizeLiterals(ctx.renamed(del.text));

          for (const [i, add] of adds.entries()) {
            if (claimed.has(i)) continue;
            // Same line, same structure, different literal: the assertion was
            // not rewritten, its expected value was edited to match whatever
            // the code now returns.
            if (normalizeLiterals(add.text) !== shape) continue;

            const before = literalsOf(del.text).join(', ');
            const after = literalsOf(add.text).join(', ');
            if (before === after) continue;

            claimed.add(i);
            findings.push(
              finding({
                rule: 'EXPECTED_VALUE_CHANGED',
                severity: 'medium',
                file: file.path,
                /* c8 ignore next -- an added line always carries a post-image number */
                line: add.newLine ?? 1,
                message: `Expected value changed: ${before} → ${after}`,
                before: del.text,
                after: add.text,
                fix_hint:
                  'Confirm the new value is the correct one, not just the one the code produces now.',
              }),
            );
            break;
          }
        }
      }
    }

    return findings;
  },
};
