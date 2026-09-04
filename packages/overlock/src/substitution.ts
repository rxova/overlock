import type { DiffFile, Rename } from './types.js';

/**
 * What a patch does that is not about its tests.
 *
 * A mass rename produces one finding per touched line, all of them true and
 * none of them the thing a reviewer wants. The question they actually have is
 * *what changed that the rename does not explain?* — and a list of 293 rows
 * makes them answer it by hand, which is the one shape a tool that claims to be
 * readable from a phone must not produce.
 *
 * So the substitution is inferred from the patch itself and every finding is
 * marked against it. Nothing is dropped: the inference is a heuristic, and a
 * heuristic that silently removed findings would be a way to launder a real
 * edit through a big enough rename. It changes what is *shown first*, and the
 * count of what it accounts for is stated rather than implied.
 */

/** Both sides of a rename must look like identifiers. */
const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * A one or two character token differs by chance far too often to be evidence
 * of anything, and a numeric literal is never a rename — `toBe(10)` becoming
 * `toBe(5)` is precisely the edit this tool exists to catch, and it must never
 * be able to hide inside an inferred substitution.
 */
const MIN_TOKEN_LENGTH = 3;

/**
 * A rename is a thing done to a codebase, not to a line. Requiring it to recur,
 * across more than one file, is what separates it from two edits that happen to
 * rhyme.
 */
const MIN_OCCURRENCES = 3;
const MIN_FILES = 2;

/** Beyond this a run is not a renamed line; it is a generated file. */
const MAX_TOKENS = 400;

/** Why a change is not what it looks like. */
export type Explanation = 'rename' | 'reformatting';

export interface PatchExplanation {
  renames: Rename[];
  /** Files where every changed line is accounted for, and by what. */
  files: Map<string, Explanation>;
  /** Whether one before/after pair is accounted for. */
  explainsEdit: (before: string, after: string) => Explanation | null;
  /** `trainmotherfoca -> trainmf`, or null when no rename was inferred. */
  label: string | null;
}

function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * Words and single separator characters. Splitting separators one at a time
 * keeps the two sides aligned positionally, which is what lets a mismatch be
 * read as a substitution rather than as an insertion.
 */
function tokenize(text: string): string[] {
  return text.match(/[A-Za-z0-9_]+|[^A-Za-z0-9_]/g) ?? [];
}

interface Run {
  before: string;
  after: string;
}

/**
 * Consecutive removals paired with the additions that replaced them.
 *
 * Joined into one string per side rather than compared line for line, because
 * a rename changes line lengths and a formatter then re-wraps: `@trainmotherfoca`
 * becoming `@tmf` is thirteen characters shorter, and an import that did not
 * fit on one line now does. Three removed lines against one added line is the
 * same edit, and only survives comparison as a blob.
 */
function runsOf(file: DiffFile): Run[] {
  const runs: Run[] = [];

  for (const hunk of file.hunks) {
    let dels: string[] = [];
    let adds: string[] = [];

    const flush = (): void => {
      if (dels.length > 0 || adds.length > 0) {
        runs.push({ before: dels.join(' '), after: adds.join(' ') });
      }
      dels = [];
      adds = [];
    };

    for (const line of hunk.lines) {
      if (line.kind === 'del') {
        if (adds.length > 0) flush();
        dels.push(line.text);
      } else if (line.kind === 'add') {
        adds.push(line.text);
      } else {
        flush();
      }
    }
    flush();
  }

  return runs;
}

/**
 * The substitutions that would turn one run into the other, or null when no
 * substitution could.
 *
 * An empty array means the two sides are already the same once whitespace is
 * collapsed — a pure reformat, which is a change by the letter and not by any
 * other measure.
 */
function candidatesFor(run: Run): { from: string; to: string }[] | null {
  const before = tokenize(collapseWhitespace(run.before));
  const after = tokenize(collapseWhitespace(run.after));

  if (before.length !== after.length) return null;
  if (before.length > MAX_TOKENS) return null;

  const pairs: { from: string; to: string }[] = [];
  for (let i = 0; i < before.length; i += 1) {
    const b = before[i] as string;
    const a = after[i] as string;
    if (b === a) continue;
    // A difference that is not one identifier for another is a real edit, and
    // one real edit anywhere in the run means the run is not a rename.
    if (!IDENTIFIER.test(b) || !IDENTIFIER.test(a)) return null;
    if (b.length < MIN_TOKEN_LENGTH || a.length < MIN_TOKEN_LENGTH) return null;
    pairs.push({ from: b, to: a });
  }

  return pairs;
}

function explainRun(run: Run, map: Map<string, string>): Explanation | null {
  const before = tokenize(collapseWhitespace(run.before));
  const after = tokenize(collapseWhitespace(run.after));

  if (before.length !== after.length) return null;

  let substituted = false;
  for (let i = 0; i < before.length; i += 1) {
    const b = before[i] as string;
    const a = after[i] as string;
    if (b === a) continue;
    if (map.get(b) !== a) return null;
    substituted = true;
  }

  return substituted ? 'rename' : 'reformatting';
}

interface Candidate {
  from: string;
  to: string;
  count: number;
  files: Set<string>;
}

export function explainPatch(files: DiffFile[]): PatchExplanation {
  const perFile = files.map((file) => ({ file, runs: runsOf(file) }));

  const candidates = new Map<string, Candidate>();
  // Every target a given name was replaced by, anywhere in the patch. A name
  // with more than one is not being renamed; it is being edited.
  const targets = new Map<string, Set<string>>();

  for (const { file, runs } of perFile) {
    for (const run of runs) {
      const pairs = candidatesFor(run);
      if (pairs === null) continue;

      for (const pair of pairs) {
        const key = `${pair.from} ${pair.to}`;
        const entry = candidates.get(key) ?? { ...pair, count: 0, files: new Set<string>() };
        entry.count += 1;
        entry.files.add(file.path);
        candidates.set(key, entry);

        const seen = targets.get(pair.from) ?? new Set<string>();
        seen.add(pair.to);
        targets.set(pair.from, seen);
      }
    }
  }

  const map = new Map<string, string>();
  const accepted: Candidate[] = [];
  for (const entry of candidates.values()) {
    if (entry.count < MIN_OCCURRENCES || entry.files.size < MIN_FILES) continue;
    if (targets.get(entry.from)?.size !== 1) continue;
    map.set(entry.from, entry.to);
    accepted.push(entry);
  }

  // `trainmotherfoca`, `TrainMotherFoca` and `TRAINMOTHERFOCA` are one rename
  // done three ways, and reporting them as three is the same noise one level up.
  const groups = new Map<string, Candidate[]>();
  for (const entry of accepted) {
    const key = `${entry.from.toLowerCase()} ${entry.to.toLowerCase()}`;
    groups.set(key, [...(groups.get(key) ?? []), entry]);
  }

  const renames: Rename[] = [...groups.values()]
    .map((group) => {
      const sorted = [...group].sort((a, b) => b.count - a.count);
      const best = sorted[0] as Candidate;
      const files = new Set(group.flatMap((entry) => [...entry.files]));
      return {
        from: best.from,
        to: best.to,
        casings: group.length,
        files: files.size,
        count: group.reduce((total, entry) => total + entry.count, 0),
      };
    })
    .sort((a, b) => b.count - a.count);

  const explained = new Map<string, Explanation>();
  for (const { file, runs } of perFile) {
    if (runs.length === 0) continue;

    let verdict: Explanation = 'reformatting';
    let all = true;
    for (const run of runs) {
      const one = explainRun(run, map);
      if (one === null) {
        all = false;
        break;
      }
      if (one === 'rename') verdict = 'rename';
    }
    if (all) explained.set(file.path, verdict);
  }

  const headline = renames[0];

  return {
    renames,
    files: explained,
    explainsEdit: (before, after) => explainRun({ before, after }, map),
    label: headline === undefined ? null : `${headline.from} -> ${headline.to}`,
  };
}

/** Whether a file's changes are whitespace and nothing else. */
export function isReformatOnly(file: DiffFile): boolean {
  const runs = runsOf(file);
  if (runs.length === 0) return false;
  return runs.every((run) => collapseWhitespace(run.before) === collapseWhitespace(run.after));
}
