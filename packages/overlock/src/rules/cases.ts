import type { DiffFile, DiffLine } from '../types.js';

/**
 * Where a test case begins and ends, as far as a diff can tell.
 *
 * Three separate complaints from people running this tool come back to the same
 * missing structure: a check that reads one line cannot tell a test that lost
 * specificity from one that gained an assertion and changed a line; a removed
 * case that came back under a new title reads as deleted; and a spec file moved
 * wholesale reads as eight unrelated deletions. All three need the diff grouped
 * by case rather than by line, so it is grouped once, here.
 *
 * It is a heuristic and it stays one: a diff carries the lines the patch
 * touched and three lines of context either side, not a parse tree. What it can
 * say reliably is which declaration a changed line most recently followed, and
 * that turns out to be enough.
 */

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

export function declaredName(text: string): string | null {
  for (const re of DECLARATIONS) {
    const m = re.exec(text);
    if (!m) continue;
    // Either group 2 (quoted title) or group 1 (identifier), whichever matched.
    const name = m[2] ?? m[1];
    if (name) return name.trim();
  }
  return null;
}

/** Whitespace-insensitive, because reindentation is not an edit. */
export function squash(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * Punctuation and nothing else — `});`, `}`, `)`.
 *
 * Excluded from every body comparison: two unrelated tests share their closing
 * braces, and counting those as evidence of a move would make every pair of
 * tests look alike.
 */
function isStructural(text: string): boolean {
  return !/[A-Za-z0-9]/.test(text);
}

export interface CaseBody {
  name: string;
  /** The declaration itself, for the line number a finding points at. */
  declaration: DiffLine;
  /** The case's own lines, squashed, with structural punctuation dropped. */
  lines: Set<string>;
}

/**
 * The lines belonging to each declared case, from one side of the diff.
 *
 * Lines before the first declaration belong to no case — imports, `beforeEach`,
 * a fixture — and are dropped rather than attributed to the case that happens
 * to follow them.
 */
export function bodies(lines: DiffLine[]): CaseBody[] {
  const found: CaseBody[] = [];
  let current: CaseBody | null = null;

  for (const line of lines) {
    const name = declaredName(line.text);
    if (name !== null) {
      current = { name, declaration: line, lines: new Set<string>() };
      found.push(current);
      continue;
    }
    if (current === null) continue;
    const text = squash(line.text);
    if (text === '' || isStructural(text)) continue;
    current.lines.add(text);
  }

  return found;
}

/** A body this small says nothing about where it went. */
const MIN_BODY = 2;

/** How much of the removed body has to reappear before it counts as the same case. */
const MIN_CONTAINMENT = 0.6;

/**
 * Whether a removed case reappears as an added one under a different title.
 *
 * Containment rather than similarity, deliberately: a case that was re-homed
 * *and* extended is still the same case, and measuring it symmetrically would
 * punish the patch for adding assertions. The question is only whether what the
 * old case asserted is still being asserted somewhere.
 */
export function isSameCase(removed: CaseBody, added: CaseBody): boolean {
  if (removed.lines.size < MIN_BODY) return false;
  let shared = 0;
  for (const line of removed.lines) if (added.lines.has(line)) shared += 1;
  return shared >= MIN_BODY && shared / removed.lines.size >= MIN_CONTAINMENT;
}

export interface CaseDelta {
  adds: DiffLine[];
  dels: DiffLine[];
}

/**
 * Changed lines grouped by the case they sit in, both sides at once.
 *
 * Two cursors rather than one: a removed line belongs to the last case declared
 * on a line the pre-image had, an added line to the last one declared on a line
 * the post-image has. During a rename the two differ for a few lines, and a
 * single cursor would file the old case's removals under the new case's name.
 *
 * Each hunk starts over. A hunk boundary is a gap of unknown size, so the
 * declaration seen before it says nothing about the lines after it — and a
 * wrong attribution here would be worse than none, since the whole purpose is
 * to judge a line by the case around it.
 */
export function byCase(file: DiffFile): Map<string, CaseDelta> {
  const cases = new Map<string, CaseDelta>();

  const entry = (name: string): CaseDelta => {
    const found = cases.get(name) ?? { adds: [], dels: [] };
    cases.set(name, found);
    return found;
  };

  for (const hunk of file.hunks) {
    let before: string | null = null;
    let after: string | null = null;

    for (const line of hunk.lines) {
      const name = declaredName(line.text);
      if (name !== null) {
        if (line.kind !== 'add') before = name;
        if (line.kind !== 'del') after = name;
        continue;
      }
      if (line.kind === 'del') {
        if (before !== null) entry(before).dels.push(line);
      } else if (line.kind === 'add') {
        if (after !== null) entry(after).adds.push(line);
      }
    }
  }

  return cases;
}
