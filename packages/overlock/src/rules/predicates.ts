import { changeBlocks } from '../diff.js';
import type { DiffLine, Finding, Severity } from '../types.js';
import { squash } from './cases.js';
import { finding, looksLikeAssertion, type Rule, type RuleContext } from './shared.js';

/**
 * The predicate that decides what an assertion ranges over.
 *
 * Every other rule here watches the assertion. None of them watches the set the
 * assertion is applied to, and that is the quietest place in a suite to take
 * coverage away: `FEATURE_KEYS.filter(k => tier(k) === 'free')` gaining
 * `&& !NOT_SOLD_AT_FREE.includes(k)` leaves every `expect` in the file byte for
 * byte identical while the loop around them stops visiting four keys. The diff
 * is one line and it reads like a clarification.
 *
 * Loop-and-filter invariants are usually a codebase's highest-leverage tests —
 * they are what stops a catalogue and its documentation drifting apart — so the
 * set they range over is worth watching on its own terms.
 */

/**
 * Positions in `text`, skipping string contents, with the bracket depth at each.
 *
 * A quote-blind scan gets `k => k !== '(('` wrong, and a rule that miscounts
 * brackets pairs the wrong halves of a predicate together.
 */
function* scan(text: string, from = 0): Generator<{ i: number; ch: string; depth: number }> {
  let depth = 0;
  let quote: string | null = null;

  for (let i = from; i < text.length; i += 1) {
    const ch = text[i] ?? '';
    if (quote !== null) {
      if (ch === '\\') i += 1;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      quote = ch;
      continue;
    }
    if (ch === '(' || ch === '[' || ch === '{') depth += 1;
    else if (ch === ')' || ch === ']' || ch === '}') depth -= 1;
    yield { i, ch, depth };
  }
}

const CLOSERS: Record<string, string> = { '(': ')', '[': ']' };

/**
 * What the bracket at `open` encloses, or null when this line does not close it.
 *
 * A diff line is one line. A predicate written across three of them arrives
 * here as a fragment, and guessing at the rest of it is how a rule invents a
 * narrowing out of a reflow.
 */
function enclosed(text: string, open: number): string | null {
  const close = CLOSERS[text[open] ?? ''];
  if (close === undefined) return null;
  for (const { i, ch, depth } of scan(text, open)) {
    if (ch === close && depth === 0) return text.slice(open + 1, i);
  }
  return null;
}

/** Split on a separator that is not inside brackets or a string. */
function splitTop(text: string, separator: string): string[] {
  const parts: string[] = [];
  let start = 0;

  for (const { i, ch, depth } of scan(text)) {
    if (depth !== 0 || ch !== separator[0] || !text.startsWith(separator, i)) continue;
    parts.push(text.slice(start, i));
    start = i + separator.length;
  }
  parts.push(text.slice(start));

  // A term reassembled from a wrapped construct keeps the separator the
  // formatter left at the end of its line, and `a` and `a,` are the same term.
  return parts.map((part) => squash(part).replace(/[,;]+$/, '')).filter((p) => p !== '');
}

/** The index of the `(` or `[` a match opens with, given the match and its text. */
function openerOf(match: RegExpExecArray): number {
  return match.index + match[0].length - 1;
}

const FILTER = /\.\s*filter\s*\(/;

/**
 * The expression a call is made on, taken from the end of what precedes it.
 *
 * The whole prefix would do as a pairing key were a diff line always one
 * statement. It is not: a reflowed block read as one logical line carries
 * whatever else the patch added above it, and keying on that makes the same
 * collection look like two.
 */
const RECEIVER = /[A-Za-z_$][\w$]*(?:\s*(?:\.\s*[A-Za-z_$][\w$]*|\[[^[\]]*\]))*\s*$/;

/** The receiver and predicate of the first `.filter(...)` on the line. */
function filterCall(text: string): { receiver: string; predicate: string } | null {
  const m = FILTER.exec(text);
  if (m === null) return null;
  const predicate = enclosed(text, openerOf(m));
  const receiver = RECEIVER.exec(text.slice(0, m.index));
  if (predicate === null || receiver === null) return null;
  return { receiver: squash(receiver[0]), predicate };
}

const FOR_OF = /\bfor\s*(?:await\s+)?\(/;
const OF = /\bof\s+/;
const EACH = /\b(?:it|test|describe)\s*\.\s*each\s*\(/;
const FOR_EACH = /\.\s*forEach\s*\(/;

/**
 * The collection a line iterates or parameterises over, when it names one.
 *
 * Also the grading signal: a set that a `for...of` or an `it.each` consumes
 * demonstrably decides how many times the assertions below it run. A set
 * assigned to a variable may or may not reach one, and a diff cannot tell.
 */
function iterationSource(text: string): string | null {
  const each = EACH.exec(text);
  if (each !== null) return enclosed(text, openerOf(each));

  const loop = FOR_OF.exec(text);
  if (loop !== null) {
    const head = enclosed(text, openerOf(loop));
    const of = head === null ? null : OF.exec(head);
    if (head !== null && of !== null) return head.slice(of.index + of[0].length);
  }

  const forEach = FOR_EACH.exec(text);
  if (forEach !== null) return text.slice(0, forEach.index);

  return null;
}

/** Members of an array literal, or null when the text is not one. */
function members(text: string): string[] | null {
  const source = squash(text);
  if (!source.startsWith('[')) return null;
  const inner = enclosed(source, 0);
  return inner === null ? null : splitTop(inner, ',');
}

const DECLARED_LIST = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]*)?=\s*\[/;

/**
 * Words that make an identifier an exclusion list.
 *
 * Narrow on purpose. A list in a test file that names what is *left out* has
 * only one direction it can move in without costing coverage, so growing one is
 * a finding; a list of what is covered growing is the opposite and stays quiet.
 */
const EXCLUSION_WORDS = new Set([
  'allow',
  'allowed',
  'allowlist',
  'except',
  'excepted',
  'exclude',
  'excluded',
  'excludes',
  'exempt',
  'exempted',
  'exemptions',
  'exempts',
  'ignore',
  'ignored',
  'known',
  'no',
  'not',
  'omit',
  'omitted',
  'pending',
  'quarantined',
  'skip',
  'skipped',
  'unsupported',
  'waive',
  'waived',
  'whitelist',
]);

function wordsOf(identifier: string): string[] {
  return identifier
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[\s_$]+/)
    .filter((w) => w !== '')
    .map((w) => w.toLowerCase());
}

/** A named list and its members, when the line declares an exclusion list. */
function exclusionList(text: string): { name: string; values: string[] } | null {
  const m = DECLARED_LIST.exec(text);
  const name = m?.[1];
  if (m === null || name === undefined) return null;
  if (!wordsOf(name).some((w) => EXCLUSION_WORDS.has(w))) return null;
  const inner = enclosed(text, openerOf(m));
  return inner === null ? null : { name, values: splitTop(inner, ',') };
}

/** Whether every member of `was` survives into `now`. */
function keepsAll(was: string[], now: string[]): boolean {
  const kept = new Set(now);
  return was.every((v) => kept.has(v));
}

interface Verdict {
  message: string;
}

/** A predicate that gained a conjunct covers a subset of what it covered. */
function conjunctGained(before: string, after: string): Verdict | null {
  const was = filterCall(before);
  const now = filterCall(after);
  if (was === null || now === null || was.receiver !== now.receiver) return null;

  const had = splitTop(was.predicate, '&&');
  const has = splitTop(now.predicate, '&&');
  if (has.length <= had.length || !keepsAll(had, has)) return null;

  const kept = new Set(had);
  const gained = has.filter((term) => !kept.has(term));
  return { message: `the filter gained a condition — ${gained.join(' && ')}` };
}

const RESTRICTING = /^\.\s*(filter|slice)\s*\(/;

/** A source that gained a `.filter(...)` or a `.slice(...)` it did not have. */
function stepGained(before: string, after: string): Verdict | null {
  const was = iterationSource(before);
  const now = iterationSource(after);
  if (was === null || now === null) return null;

  const had = squash(was);
  const has = squash(now);
  if (had === '' || !has.startsWith(had)) return null;

  const step = RESTRICTING.exec(has.slice(had.length));
  return step === null ? null : { message: `the iterated source gained a .${step[1]}(...) step` };
}

/** A literal list of cases that lost members without gaining any. */
function membersLost(before: string, after: string): Verdict | null {
  const was = iterationSource(before);
  const now = iterationSource(after);
  if (was === null || now === null) return null;

  const had = members(was);
  const has = members(now);
  if (had === null || has === null || had.length < 2) return null;
  if (has.length >= had.length || !keepsAll(has, had)) return null;

  return { message: `${had.length} values were iterated, now ${has.length}` };
}

/** An exclusion list that grew, which is a covered set that shrank. */
function exclusionGrew(before: string, after: string): Verdict | null {
  const was = exclusionList(before);
  const now = exclusionList(after);
  if (was === null || now === null || was.name !== now.name) return null;
  if (now.values.length <= was.values.length || !keepsAll(was.values, now.values)) return null;

  const kept = new Set(was.values);
  const gained = now.values.filter((v) => !kept.has(v));
  return { message: `${was.name} exempts ${gained.length} more: ${gained.join(', ')}` };
}

const SHAPES = [conjunctGained, stepGained, membersLost, exclusionGrew];

/**
 * A set that a loop or a parameterisation consumes decides how many times the
 * assertions under it run, so shrinking it is the same event as deleting them.
 * A set assigned to a variable might be a fixture nothing asserts over, and
 * `medium` is what this repository grades a rule that cannot tell.
 */
function gradeOf(text: string): Severity {
  return iterationSource(text) !== null || looksLikeAssertion(text) ? 'high' : 'medium';
}

/**
 * The block's lines on one side, as one logical line.
 *
 * A predicate that grew past the line width is reflowed onto three lines by the
 * formatter in the same commit, and each of those lines on its own is an
 * unbalanced fragment. Joined, the block reads as what was written. Tried only
 * when the line-by-line pass found nothing, so a patch that can be explained
 * one line at a time still is.
 */
function joined(lines: DiffLine[]): string {
  return lines.map((l) => l.text).join(' ');
}

interface Match {
  before: string;
  after: string;
  line: DiffLine;
  verdict: Verdict;
}

function firstVerdict(before: string, after: string): Verdict | null {
  return SHAPES.reduce<Verdict | null>((found, shape) => found ?? shape(before, after), null);
}

/** Every narrowing in one run of changed lines, each answering addition claimed once. */
function matchesIn(block: DiffLine[], renamed: (text: string) => string): Match[] {
  const adds = block.filter((l) => l.kind === 'add');
  const dels = block.filter((l) => l.kind === 'del');
  const claimed = new Set<DiffLine>();
  const found: Match[] = [];

  for (const del of dels) {
    // The pre-image is read under the patch's inferred rename for the same
    // reason the assertion rules read it that way: a set narrowed in the commit
    // that renamed the thing it is built from is still a narrowing, and the two
    // halves only line up once it is applied.
    const before = renamed(del.text);

    for (const add of adds) {
      if (claimed.has(add)) continue;
      const verdict = firstVerdict(before, add.text);
      if (verdict === null) continue;
      claimed.add(add);
      found.push({ before: del.text, after: add.text, line: add, verdict });
      break;
    }
  }

  if (found.length > 0) return found;

  const reflowed = reflowedMatch(dels, adds, renamed);
  return reflowed === null ? [] : [reflowed];
}

/**
 * How many added lines a reflowed construct is worth reassembling from.
 *
 * A predicate the formatter wrapped is a handful of lines. A block larger than
 * this is a rewrite, and searching a rewrite for a window that happens to read
 * as a narrowing is both slow and a way to manufacture one.
 */
const MAX_REFLOW_LINES = 40;

/**
 * The narrowing a wrapped construct hides, from the smallest window that shows it.
 *
 * Smallest rather than the whole run, because the window is what the finding
 * quotes: a patch that added a constant above the predicate it reflowed should
 * not have that constant read back to it as evidence.
 */
function reflowedMatch(
  dels: DiffLine[],
  adds: DiffLine[],
  renamed: (text: string) => string,
): Match | null {
  if (dels.length === 0 || adds.length < 2) return null;
  if (dels.length > MAX_REFLOW_LINES || adds.length > MAX_REFLOW_LINES) return null;

  const before = renamed(joined(dels));

  // From two lines up: a single line has already been tried on its own.
  for (let size = 2; size <= adds.length; size += 1) {
    for (let start = 0; start + size <= adds.length; start += 1) {
      const window = adds.slice(start, start + size);
      const head = window[0];
      const after = joined(window);
      const verdict = firstVerdict(before, after);
      /* c8 ignore next -- a window of at least two lines always has a first */
      if (verdict === null || head === undefined) continue;
      return { before: joined(dels), after, line: head, verdict };
    }
  }

  return null;
}

export const predicateNarrowed: Rule = {
  rule: 'PREDICATE_NARROWED',
  run(ctx: RuleContext): Finding[] {
    const findings: Finding[] = [];

    for (const file of ctx.files) {
      if (file.status === 'deleted' || !ctx.isTest(file.path)) continue;

      for (const hunk of file.hunks) {
        for (const block of changeBlocks(hunk)) {
          for (const match of matchesIn(block, ctx.renamed)) {
            findings.push(
              finding({
                rule: 'PREDICATE_NARROWED',
                severity: gradeOf(match.after),
                file: file.path,
                /* c8 ignore next -- an added line always carries a post-image number */
                line: match.line.newLine ?? 1,
                message:
                  `Test input narrowed: ${match.verdict.message}. ` +
                  'The assertions are unchanged; there are fewer of them to run.',
                before: match.before,
                after: match.after,
                fix_hint:
                  'Keep the set the assertions ranged over, or say what covers the members it no longer includes.',
              }),
            );
          }
        }
      }
    }

    return findings;
  },
};
