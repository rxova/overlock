import { addedLines, removedLines } from '../diff.js';
import type { Finding } from '../types.js';
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

/** Matchers that pin down a value. */
const STRICT =
  /\b(?:toBe|toEqual|toStrictEqual|toMatchObject|toHaveBeenCalledWith|assertEqual|assertEquals|toContain|toHaveLength)\s*\(/;

/** Matchers that assert only that something exists. */
const LOOSE =
  /\b(?:toBeDefined|toBeTruthy|toBeFalsy|toBeNull|toBeUndefined|toHaveBeenCalled|toBeInstanceOf|assertTrue|assertIsNotNone|assertIsNone|any)\s*\(/;

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

export const assertionWeakened: Rule = {
  rule: 'ASSERTION_WEAKENED',
  run(ctx: RuleContext): Finding[] {
    const findings: Finding[] = [];

    for (const file of ctx.files) {
      if (file.status === 'deleted' || !ctx.isTest(file.path)) continue;

      for (const hunk of file.hunks) {
        const dels = hunk.lines.filter((l) => l.kind === 'del' && STRICT.test(l.text));
        const adds = hunk.lines.filter((l) => l.kind === 'add' && LOOSE.test(l.text));

        for (const del of dels) {
          // Pairing on the `expect(...)` subject is what keeps this precise: an
          // unrelated strict assertion removed in the same hunk as an unrelated
          // loose one added is not a weakening, and without the subject check
          // it would read as one.
          //
          // The subject is taken from the renamed pre-image, because the
          // subject is where a rename lands: `expect(trainmotherfoca.total())`
          // becoming `expect(trainmf.total()).toBeDefined()` is a weakening
          // whose two halves would otherwise never be seen as a pair.
          const subject = expectSubject(ctx.renamed(del.text));
          const match = adds.find((a) =>
            subject === null ? false : expectSubject(a.text) === subject,
          );
          if (!match) continue;

          findings.push(
            finding({
              rule: 'ASSERTION_WEAKENED',
              severity: 'high',
              file: file.path,
              /* c8 ignore next -- an added line always carries a post-image number */
              line: match.newLine ?? del.oldLine ?? 1,
              message: 'An exact assertion was replaced with one that only checks existence.',
              before: del.text,
              after: match.text,
              fix_hint: 'Assert the value, not that a value is present.',
            }),
          );
        }
      }
    }

    return findings;
  },
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
