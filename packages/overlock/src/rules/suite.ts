/**
 * The suite as a whole: whether it still runs, and whether its failure counts.
 *
 * Every other rule in here reads a test file. None of them reads the two files
 * that decide whether any of it matters — the workflow that invokes the runner
 * and the config that tells the runner what to collect. That is the quietest
 * place in a repository to make a suite ask less than it did, because nothing
 * inside a single test changes:
 *
 *   continue-on-error: true      the tests still run, and failing is now free
 *   "test": "vitest run || true" the same move, one level down
 *   --passWithNoTests            an empty run is a green run
 *   include: ['src/core/**']     the same set-shrinking PREDICATE_NARROWED
 *                                watches, one level up: the runner's include
 *                                list *is* the set the suite ranges over
 *   the test job deleted         TEST_REMOVED already catches a test file
 *                                renamed out of the runner's glob; this is the
 *                                glob moved off the file, which is the same
 *                                outcome from the opposite direction
 *
 * Both rules read config files only. A marker in a test file is a test file's
 * business, and a `|| true` in prose is prose.
 */
import { isCiConfig, isRunnerConfig } from '../paths.js';
import type { DiffFile, DiffLine, Finding, Hunk, Severity } from '../types.js';
import { finding, type Rule, type RuleContext } from './shared.js';

/**
 * Commands that run a test suite.
 *
 * Wide across ecosystems and narrow within each: `playwright test` rather than
 * `playwright`, because `npx playwright install` is a setup step and reading it
 * as the gate would make every dependency bump look like a removal.
 */
const TEST_COMMANDS: RegExp[] = [
  /\b(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?test\b/,
  /\b(?:vitest|jest|mocha|jasmine|ava|nyc|gotestsum)\b/,
  /\bkarma\s+start\b/,
  /\bplaywright\s+test\b/,
  /\bcypress\s+run\b/,
  /\b(?:pytest|py\.test)\b/,
  /\bpython\s+-m\s+(?:pytest|unittest)\b/,
  /\btox\b/,
  /\bgo\s+test\b/,
  /\bcargo\s+(?:test|nextest)\b/,
  /\bmvn\b[^\n]*\btest\b/,
  /\bgradlew?\b[^\n]*\btest\b/,
  /\brspec\b/,
  /\brake\s+(?:test|spec)\b/,
  /\bphpunit\b/,
  /\bdotnet\s+test\b/,
  /\bbazel\s+test\b/,
  /\bctest\b/,
  /\bmake\s+test\b/,
  /\bturbo\s+run\s+test\b/,
  /\bnx\s+[\w:-]*test\b/,
  /\bdeno\s+test\b/,
  /\bmix\s+test\b/,
  /\bswift\s+test\b/,
  // A package manifest's own script entry: `"test": "..."`, `"test:e2e": "..."`.
  // Lower case only, so `"testMatch": [...]` — a glob, not an invocation — is
  // not read as one.
  /"(?:test|tests)[a-z0-9:._-]*"\s*:/,
];

function invokesTests(text: string): boolean {
  return TEST_COMMANDS.some((re) => re.test(text));
}

/**
 * Which invocations a line carries, as the patterns that matched it.
 *
 * Used to answer "is this same suite still invoked somewhere?" without
 * comparing command text, which no two CI files write the same way.
 */
function testKeys(text: string): string[] {
  return TEST_COMMANDS.filter((re) => re.test(text)).map((re) => re.source);
}

/**
 * A commented-out line is a note, not a gate.
 *
 * `#` opens a comment in YAML, a Makefile and a shell script, which between
 * them are most of what this rule reads.
 */
function isCommented(text: string): boolean {
  return /^\s*(?:#|\/\/|\*|\/\*)/.test(text);
}

/** Ways of saying "and if it fails, carry on". */
const NEUTRALISERS: { re: RegExp; label: string }[] = [
  { re: /\|\|\s*true\b/, label: '|| true' },
  { re: /\|\|\s*:(?:\s|$|["',])/, label: '|| :' },
  { re: /\|\|\s*exit\s+0\b/, label: '|| exit 0' },
  { re: /;\s*(?:true|exit\s+0)\s*(?:$|["',])/, label: '; true' },
];

/** An empty run reported as a passing run. */
const PASS_WITH_NO_TESTS = /--pass[-_]?with[-_]?no[-_]?tests\b|\bpassWithNoTests\s*:\s*true\b/i;

const CONTINUE_ON_ERROR = /\bcontinue-on-error\s*:\s*["']?true["']?/;
const NEVER_RUNS = /\bif\s*:\s*["']?(?:false|\$\{\{\s*false\s*\}\})["']?\s*$/;

/**
 * Lines that say the thing around them is about tests: a step name, an id, or
 * a job key.
 *
 * A diff carries three lines of context, which is usually enough to see the
 * `run:` or the `name:` a `continue-on-error:` belongs to — and when it is not,
 * the finding is graded down rather than dropped.
 */
const TEST_LABELS: RegExp[] = [
  /^\s*(?:-\s*)?(?:name|id)\s*:.*\btests?\b/i,
  /^\s*[\w-]*tests?[\w-]*\s*:\s*$/i,
];

function aboutTests(hunk: Hunk): boolean {
  return hunk.lines.some((l) => invokesTests(l.text) || TEST_LABELS.some((re) => re.test(l.text)));
}

/** Every invocation this patch adds to a gate file, so a move is not a removal. */
function invokedAnywhere(files: DiffFile[]): Set<string> {
  const keys = new Set<string>();
  for (const file of files) {
    for (const h of file.hunks) {
      for (const line of h.lines) {
        if (line.kind !== 'add' || isCommented(line.text)) continue;
        for (const key of testKeys(line.text)) keys.add(key);
      }
    }
  }
  return keys;
}

interface Disabled {
  severity: Severity;
  message: string;
  fix_hint: string;
}

/**
 * What an added line does to the gate, or null when it does nothing to it.
 *
 * Ordered by how much the diff establishes. A neutraliser sitting on a test
 * command says what it says with no context needed; a `continue-on-error:` says
 * it only once you know which step it belongs to.
 */
function disables(line: DiffLine, hunk: Hunk): Disabled | null {
  const neutraliser = NEUTRALISERS.find((n) => n.re.test(line.text));
  if (neutraliser !== undefined && invokesTests(line.text)) {
    return {
      severity: 'high',
      message: `Test command made unable to fail — \`${neutraliser.label}\` swallows its exit code.`,
      fix_hint: 'Let the command fail the build, and fix the tests that fail it.',
    };
  }

  if (PASS_WITH_NO_TESTS.test(line.text)) {
    return {
      severity: 'medium',
      message: 'Runner told to pass when it collects no tests — an empty run is now a green run.',
      fix_hint:
        'Check the runner still collects the tests it did. The flag is only safe where a package genuinely has none.',
    };
  }

  const disabler = CONTINUE_ON_ERROR.test(line.text)
    ? 'continue-on-error: true'
    : NEVER_RUNS.test(line.text)
      ? 'if: false'
      : null;
  if (disabler === null) return null;

  // `continue-on-error` on the step that runs the tests is the whole move.
  // On some other step it is ordinary CI tuning, and the diff cannot always
  // tell which — so the grade says which of the two this is.
  return aboutTests(hunk)
    ? {
        severity: 'high',
        message: `\`${disabler}\` added to a step that runs tests — the suite can fail without failing the build.`,
        fix_hint:
          'Take it off the test step. A test failure that does not fail the build is not a gate.',
      }
    : {
        severity: 'medium',
        message: `\`${disabler}\` added. The diff does not show which step it belongs to.`,
        fix_hint: 'Check it is not the step that runs the tests.',
      };
}

/**
 * A test invocation this patch took out of a gate file and put back nowhere.
 *
 * One finding per file rather than one per line: deleting a workflow that ran
 * tests in four jobs is one decision, and four acknowledgements for it is three
 * more than anybody reads.
 */
function gateRemoved(file: DiffFile, elsewhere: Set<string>): Finding | null {
  const survives = new Set<string>(elsewhere);
  for (const h of file.hunks) {
    for (const line of h.lines) {
      if (line.kind === 'del' || isCommented(line.text)) continue;
      for (const key of testKeys(line.text)) survives.add(key);
    }
  }

  const gone: DiffLine[] = [];
  for (const h of file.hunks) {
    for (const line of h.lines) {
      if (line.kind !== 'del' || isCommented(line.text)) continue;
      const keys = testKeys(line.text);
      if (keys.length === 0 || keys.some((key) => survives.has(key))) continue;
      gone.push(line);
    }
  }

  const first = gone[0];
  if (first === undefined) return null;

  const what = file.status === 'deleted' ? 'File deleted' : 'Removed';
  return finding({
    rule: 'TEST_GATE_DISABLED',
    severity: 'high',
    file: file.path,
    // A deleted file has no line to go and look at, and pointing at one sends a
    // reviewer to a file that is not there.
    line: file.status === 'deleted' ? null : (first.oldLine ?? 1),
    message:
      `${what} — ${gone.length} test invocation${gone.length === 1 ? '' : 's'} gone from this ` +
      'gate, and nothing in this patch runs them instead.',
    before: first.text,
    fix_hint:
      'Put the invocation back, or point at where the suite runs now. Nothing in the patch does.',
  });
}

export const testGateDisabled: Rule = {
  rule: 'TEST_GATE_DISABLED',
  run(ctx: RuleContext): Finding[] {
    const findings: Finding[] = [];
    const gates = ctx.files.filter((f) => isCiConfig(f.path) || isRunnerConfig(f.path));
    const elsewhere = invokedAnywhere(gates);

    for (const file of gates) {
      for (const h of file.hunks) {
        for (const line of h.lines) {
          if (line.kind !== 'add' || isCommented(line.text)) continue;
          const verdict = disables(line, h);
          if (verdict === null) continue;

          findings.push(
            finding({
              rule: 'TEST_GATE_DISABLED',
              severity: verdict.severity,
              file: file.path,
              /* c8 ignore next -- an added line always carries a post-image number */
              line: line.newLine ?? 1,
              message: verdict.message,
              after: line.text,
              fix_hint: verdict.fix_hint,
            }),
          );
        }
      }

      const removed = gateRemoved(file, elsewhere);
      if (removed !== null) findings.push(removed);
    }

    return findings;
  },
};

/** Keys naming the set a runner collects. */
const INCLUDE_KEYS = [
  'include',
  'testMatch',
  'testRegex',
  'testPathPattern',
  'testPathPatterns',
  'roots',
  'testDir',
  'testDirs',
  'testpaths',
  'spec',
  'specs',
  'specPattern',
  'testFiles',
];

/** Keys naming what it leaves out, which is the same set from the other side. */
const EXCLUDE_KEYS = [
  'exclude',
  'excludes',
  'excludeSpecPattern',
  'ignore',
  'ignorePatterns',
  'testPathIgnorePatterns',
  'modulePathIgnorePatterns',
  'coveragePathIgnorePatterns',
  'norecursedirs',
];

type ListKind = 'include' | 'exclude';

function listKind(key: string): ListKind | null {
  if (INCLUDE_KEYS.includes(key)) return 'include';
  if (EXCLUDE_KEYS.includes(key)) return 'exclude';
  return null;
}

const OPEN_LIST = /["']?([A-Za-z_][\w-]*)["']?\s*[:=]\s*\[/;

/** The list a line opens, and whatever of it the same line already holds. */
function opensList(text: string): { key: string; kind: ListKind; rest: string } | null {
  const m = OPEN_LIST.exec(text);
  const key = m?.[1];
  if (m === null || key === undefined) return null;
  const kind = listKind(key);
  return kind === null ? null : { key, kind, rest: text.slice(m.index + m[0].length) };
}

/** Quoted members, unquoted. */
function patternsIn(text: string): string[] {
  return (text.match(/(['"`])(?:\\.|(?!\1)[^\\])*\1/g) ?? []).map((s) => s.slice(1, -1));
}

/**
 * Whether `wide` collects everything `narrow` does and more.
 *
 * The old pattern is read as a matcher and the new one as a path handed to it:
 * `src/**\/*.test.ts` matches the string `src/core/**\/*.test.ts`, so the second
 * is the first with a directory pinned down. It is a heuristic and it only ever
 * grades a finding the members already justify — a glob that changed into an
 * unrelated one (`*.test.ts` to `*.spec.ts`) matches nothing and says nothing.
 */
function globCovers(wide: string, narrow: string): boolean {
  if (wide === narrow) return false;
  const source = wide.replace(/\*\*|\*|[.+^${}()|[\]\\]/g, (token) => {
    if (token === '**') return '.*';
    if (token === '*') return '[^/]*';
    return `\\${token}`;
  });
  return new RegExp(`^${source}$`).test(narrow);
}

interface Bucket {
  kind: ListKind;
  lost: string[];
  gained: string[];
  before: string | null;
  after: DiffLine | null;
  from: DiffLine | null;
}

function bucketFor(buckets: Map<string, Bucket>, key: string, kind: ListKind): Bucket {
  const existing = buckets.get(key);
  if (existing !== undefined) return existing;
  const fresh: Bucket = { kind, lost: [], gained: [], before: null, after: null, from: null };
  buckets.set(key, fresh);
  return fresh;
}

function record(bucket: Bucket, line: DiffLine, values: string[]): void {
  if (values.length === 0) return;
  if (line.kind === 'del') {
    bucket.lost.push(...values);
    bucket.before ??= line.text;
    bucket.from ??= line;
    return;
  }
  if (line.kind === 'add') {
    bucket.gained.push(...values);
    bucket.after ??= line;
  }
}

/**
 * The lists a hunk changed, whether written on one line or spread over several.
 *
 * The multi-line form is the one that matters: a member dropped from a wrapped
 * array arrives as a lone quoted string with no key anywhere near it, and read
 * line by line it is not a list change at all.
 */
function listChanges(hunk: Hunk): Map<string, Bucket> {
  const buckets = new Map<string, Bucket>();
  let open: { key: string; kind: ListKind } | null = null;

  for (const line of hunk.lines) {
    const opened = opensList(line.text);
    if (opened !== null) {
      record(bucketFor(buckets, opened.key, opened.kind), line, patternsIn(opened.rest));
      open = opened.rest.includes(']') ? null : { key: opened.key, kind: opened.kind };
      continue;
    }
    if (open === null) continue;
    record(bucketFor(buckets, open.key, open.kind), line, patternsIn(line.text));
    if (line.text.includes(']')) open = null;
  }

  return buckets;
}

function listVerdict(key: string, bucket: Bucket): string | null {
  const dropped = bucket.lost.filter((p) => !bucket.gained.includes(p));
  const added = bucket.gained.filter((p) => !bucket.lost.includes(p));

  if (bucket.kind === 'exclude') {
    if (added.length === 0 || dropped.length > 0) return null;
    return `"${key}" now leaves out ${added.length} more: ${added.join(', ')}`;
  }

  if (dropped.length === 0) return null;
  if (added.length === 0) {
    return `"${key}" lost ${dropped.length} pattern${dropped.length === 1 ? '' : 's'}: ${dropped.join(', ')}`;
  }
  // Replaced rather than dropped: a finding only when every pattern that
  // arrived is inside one that left, which is a narrowing and not a rewrite.
  if (!added.every((n) => dropped.some((w) => globCovers(w, n)))) return null;
  return `"${key}" narrowed: ${dropped.join(', ')} -> ${added.join(', ')}`;
}

/** Flags that make a runner collect everything and then run part of it. */
const NARROWING_FLAGS: { re: RegExp; label: string }[] = [
  { re: /--testPathPatterns?\b/, label: '--testPathPattern' },
  { re: /--test(?:Name|-name-)[Pp]attern\b/, label: '--testNamePattern' },
  { re: /\s-k\s/, label: '-k' },
  { re: /\s-run\s/, label: '-run' },
  { re: /--grep\b/, label: '--grep' },
  { re: /--filter[=\s]/, label: '--filter' },
  { re: /--project[=\s]/, label: '--project' },
  { re: /--dir[=\s]/, label: '--dir' },
  { re: /--spec[=\s]/, label: '--spec' },
];

function narrowingFlag(text: string): { re: RegExp; label: string } | undefined {
  return NARROWING_FLAGS.find((f) => f.re.test(text));
}

/**
 * A test command that gained a filter it did not have.
 *
 * Graded `medium`, not `high`: a diff cannot tell a suite split across two CI
 * jobs from a suite cut in half, and only one of those is a weakening.
 */
function filterGained(file: DiffFile, hunk: Hunk): Finding[] {
  const findings: Finding[] = [];
  const dels = hunk.lines.filter(
    (l) =>
      l.kind === 'del' && !isCommented(l.text) && invokesTests(l.text) && !narrowingFlag(l.text),
  );

  for (const line of hunk.lines) {
    if (line.kind !== 'add' || isCommented(line.text) || !invokesTests(line.text)) continue;
    const flag = narrowingFlag(line.text);
    if (flag === undefined) continue;

    const keys = testKeys(line.text);
    const was = dels.find((d) => testKeys(d.text).some((k) => keys.includes(k)));
    if (was === undefined) continue;

    findings.push(
      finding({
        rule: 'SUITE_SCOPE_NARROWED',
        severity: 'medium',
        file: file.path,
        /* c8 ignore next -- an added line always carries a post-image number */
        line: line.newLine ?? 1,
        message:
          `Test command gained a filter (\`${flag.label}\`) — the runner still collects every ` +
          'test and runs a subset of them.',
        before: was.text,
        after: line.text,
        fix_hint:
          'Say where the rest of the suite runs, or take the filter off. A subset that is green says nothing about the rest.',
      }),
    );
  }

  return findings;
}

export const suiteScopeNarrowed: Rule = {
  rule: 'SUITE_SCOPE_NARROWED',
  run(ctx: RuleContext): Finding[] {
    const findings: Finding[] = [];

    for (const file of ctx.files) {
      if (file.status === 'deleted') continue;
      // A file the patch creates has no prior set to shrink. Read line by line
      // an added config is all gains and no losses, which is exactly the shape
      // of a narrowed exclude list — so without this every new package reads as
      // a weakening.
      if (file.status === 'added') continue;
      const runner = isRunnerConfig(file.path);
      if (!runner && !isCiConfig(file.path)) continue;

      for (const hunk of file.hunks) {
        findings.push(...filterGained(file, hunk));
        if (!runner) continue;

        for (const [key, bucket] of listChanges(hunk)) {
          const verdict = listVerdict(key, bucket);
          const at = bucket.after ?? bucket.from;
          if (verdict === null || at === null) continue;

          findings.push(
            finding({
              rule: 'SUITE_SCOPE_NARROWED',
              severity: 'high',
              file: file.path,
              line: (at.kind === 'add' ? at.newLine : at.oldLine) ?? 1,
              message: `The set the runner collects shrank: ${verdict}.`,
              ...(bucket.before === null ? {} : { before: bucket.before }),
              ...(bucket.after === null ? {} : { after: bucket.after.text }),
              fix_hint:
                'Keep the set the runner collected, or say where the tests it no longer reaches are run.',
            }),
          );
        }
      }
    }

    return findings;
  },
};
