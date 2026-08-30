/**
 * Which files are tests, and which implementation a test is about.
 *
 * Deliberately pattern-based rather than runner-configured. Reading a project's
 * vitest/jest/pytest config to learn its true test glob would be more correct
 * and would also mean parsing five config formats, resolving their presets, and
 * failing closed when a project uses a sixth. These patterns cover the
 * conventions in use; a project that disagrees can pass `--test-glob`.
 */

const TEST_PATTERNS: RegExp[] = [
  // JS/TS: foo.test.ts, foo.spec.tsx, foo.test.mjs
  /\.(test|spec)\.[cm]?[jt]sx?$/,
  // Directory conventions, any language
  /(^|\/)(__tests__|__test__|tests?|spec)\//,
  // Python: test_foo.py, foo_test.py, conftest.py
  /(^|\/)test_[^/]+\.py$/,
  /_test\.py$/,
  /(^|\/)conftest\.py$/,
  // Go
  /_test\.go$/,
  // Rust integration tests live in tests/, covered by the directory rule above
  // Java / Kotlin
  /(Test|Tests|Spec)\.(java|kt)$/,
  // Ruby
  /_spec\.rb$/,
  /_test\.rb$/,
  // C#
  /(Test|Tests)\.cs$/,
];

const SNAPSHOT_PATTERNS: RegExp[] = [/\.snap$/, /(^|\/)__snapshots__\//, /\.ambr$/];

/** Config files whose numbers gate a build rather than describe one. */
const THRESHOLD_CONFIG_PATTERNS: RegExp[] = [
  /(^|\/)(vitest|jest|karma|nyc|stryker)\.config\.[cm]?[jt]s$/,
  /(^|\/)\.nycrc(\.json)?$/,
  /(^|\/)jest\.config\.json$/,
  /(^|\/)codecov\.ya?ml$/,
  /(^|\/)\.codecov\.ya?ml$/,
  /(^|\/)package\.json$/,
  /(^|\/)pyproject\.toml$/,
  /(^|\/)setup\.cfg$/,
  /(^|\/)\.coveragerc$/,
  /(^|\/)sonar-project\.properties$/,
  /(^|\/)tox\.ini$/,
];

export function isTestFile(path: string, extraGlobs: RegExp[] = []): boolean {
  if (isSnapshotFile(path)) return false;
  return [...TEST_PATTERNS, ...extraGlobs].some((re) => re.test(path));
}

export function isSnapshotFile(path: string): boolean {
  return SNAPSHOT_PATTERNS.some((re) => re.test(path));
}

export function isThresholdConfig(path: string): boolean {
  return THRESHOLD_CONFIG_PATTERNS.some((re) => re.test(path));
}

/**
 * The bare subject a test file is named after: `src/auth/login.test.ts` and
 * `tests/test_login.py` both reduce to `login`.
 *
 * Used only to pair a changed test with a changed implementation. It is a
 * heuristic and it is treated as one — the rule it feeds is `low` severity and
 * never blocks.
 */
export function testSubject(path: string): string | null {
  const withoutExt = basename(path).replace(/\.[^.]+$/, '');

  const candidates = [
    /^(.*)\.(test|spec)$/,
    /^test_(.*)$/,
    /^(.*)_test$/,
    /^(.*)_spec$/,
    /^(.*)(Test|Tests|Spec)$/,
  ];

  for (const re of candidates) {
    const m = re.exec(withoutExt);
    const captured = m?.[1];
    if (captured) return captured.toLowerCase();
  }

  // A file inside __tests__/ that carries no marker in its own name: the whole
  // stem is the subject.
  if (isTestFile(path)) return withoutExt.toLowerCase();
  return null;
}

/** The stem of a non-test source file, for pairing against `testSubject`. */
export function sourceSubject(path: string): string {
  return basename(path)
    .replace(/\.[^.]+$/, '')
    .toLowerCase();
}

/** Always defined, unlike `split('/').pop()`, which the type system doubts. */
function basename(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}
