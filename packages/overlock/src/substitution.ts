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

/**
 * How many things one name is allowed to have become.
 *
 * Splitting one concept into two is among the commonest refactors there is —
 * `cloud_sync` becoming `cloud_backup` in some places and `multi_device` in
 * others — and refusing to infer it left a patch reporting twenty-five
 * unexplained findings, twenty-two of which were that one split seen twenty-two
 * times. A reviewer given that number reads it as twenty-five things to check.
 *
 * Two, and not more: each target still has to clear the same recurrence bar on
 * its own, and a name that became five different things is being edited, not
 * renamed. That is the line this number draws.
 */
const MAX_TARGETS = 2;

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
  /**
   * A pre-image line with the inferred substitution applied, so a rule can
   * compare it against the post-image on equal terms.
   */
  applyRenames: (text: string) => string;
  /** `warehouserouting -> routing`, or null when no rename was inferred. */
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
 * a rename changes line lengths and a formatter then re-wraps: `@warehouserouting`
 * becoming `@routing` is nine characters shorter, and an import that did not
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

function explainRun(run: Run, map: Map<string, Set<string>>): Explanation | null {
  const before = tokenize(collapseWhitespace(run.before));
  const after = tokenize(collapseWhitespace(run.after));

  if (before.length !== after.length) return null;

  let substituted = false;
  for (let i = 0; i < before.length; i += 1) {
    const b = before[i] as string;
    const a = after[i] as string;
    if (b === a) continue;
    // Any of the things this name became: one line took one of the branches of
    // a split, and which branch it took is not what makes it a rename.
    if (map.get(b)?.has(a) !== true) return null;
    substituted = true;
  }

  return substituted ? 'rename' : 'reformatting';
}

/**
 * Rewrites the accepted substitutions wherever they appear as whole words.
 *
 * Every key is an identifier — `IDENTIFIER` saw to that before it became a
 * candidate — so it needs no regex escaping and `\b` means what it says. Where
 * no rename was inferred this is the identity, which is the common case and
 * costs nothing.
 */
function substituter(map: Map<string, string>): (text: string) => string {
  if (map.size === 0) return (text) => text;

  const pattern = new RegExp(`\\b(?:${[...map.keys()].join('|')})\\b`, 'g');
  return (text) => text.replace(pattern, (name) => map.get(name) ?? name);
}

/**
 * The dominant target per name, for the substitution rules pair against.
 *
 * A split has no single answer to "what did this line become", so pairing takes
 * the busier branch and the other branch simply does not pair. That is the
 * honest failure: a rule that fires on the branch it could read is better than
 * one that guesses, and `explainRun` — which is what marks a finding as
 * accounted for — reads both.
 */
function dominant(accepted: Candidate[]): Map<string, string> {
  const best = new Map<string, Candidate>();
  for (const entry of accepted) {
    const current = best.get(entry.from);
    if (current === undefined || entry.count > current.count) best.set(entry.from, entry);
  }
  return new Map([...best].map(([from, entry]) => [from, entry.to]));
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
      }
    }
  }

  // Only the targets that stand on their own count towards the split limit: a
  // name renamed wholesale plus one line where it was genuinely edited is one
  // rename, and the edit is the thing that must not be explained away.
  const attested = new Map<string, Set<string>>();
  for (const entry of candidates.values()) {
    if (entry.count < MIN_OCCURRENCES || entry.files.size < MIN_FILES) continue;
    const seen = attested.get(entry.from) ?? new Set<string>();
    seen.add(entry.to);
    attested.set(entry.from, seen);
  }

  const map = new Map<string, Set<string>>();
  const accepted: Candidate[] = [];
  for (const entry of candidates.values()) {
    if (entry.count < MIN_OCCURRENCES || entry.files.size < MIN_FILES) continue;
    const size = attested.get(entry.from)?.size ?? 0;
    if (size > MAX_TARGETS) continue;
    const targeted = map.get(entry.from) ?? new Set<string>();
    targeted.add(entry.to);
    map.set(entry.from, targeted);
    accepted.push(entry);
  }

  // `warehouserouting`, `WarehouseRouting` and `WAREHOUSEROUTING` are one rename
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
    applyRenames: substituter(dominant(accepted)),
    label: headline === undefined ? null : describeRename(headline.from, renames),
  };
}

/** `cloud_sync -> cloud_backup + multi_device`, so a split reads as one thing. */
function describeRename(from: string, renames: Rename[]): string {
  const targets = renames.filter((r) => r.from === from).map((r) => r.to);
  return `${from} -> ${targets.join(' + ')}`;
}

/** Whether a file's changes are whitespace and nothing else. */
export function isReformatOnly(file: DiffFile): boolean {
  const runs = runsOf(file);
  if (runs.length === 0) return false;
  return runs.every((run) => collapseWhitespace(run.before) === collapseWhitespace(run.after));
}
