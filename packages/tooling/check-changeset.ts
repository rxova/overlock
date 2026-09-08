/**
 * A change to the published package needs a changeset, or the release goes out
 * with an empty changelog and an unchanged version.
 *
 * Docs, CI config and the tooling package are exempt: they ship nothing.
 */
import { execFileSync } from 'node:child_process';
import { isEntry } from './entry.js';

/** How the range is read. Injected so the rule can be tested without a repo. */
export type Differ = (base: string, head: string) => string[];

export const gitDiff: Differ = (base, head) =>
  execFileSync('git', ['diff', '--name-only', `${base}...${head}`], { encoding: 'utf8' })
    .split('\n')
    .filter(Boolean);

/**
 * Whether the diff touches something that actually ships. Markdown, e2e suites
 * and unit tests inside the package are excluded: none of them reach the
 * tarball, so none of them need a changelog entry.
 */
export const touchesPackage = (changed: string[]): boolean =>
  changed.some(
    (file) =>
      file.startsWith('packages/overlock/') &&
      !file.endsWith('.md') &&
      !file.includes('/e2e/') &&
      !file.endsWith('.test.ts'),
  );

export const hasChangeset = (changed: string[]): boolean =>
  changed.some(
    (file) => file.startsWith('.changeset/') && file.endsWith('.md') && !file.endsWith('README.md'),
  );

/**
 * The label that says this pull request needs no changelog entry.
 *
 * A dependency bump changes what the repository builds *with* and nothing about
 * what it publishes, so the gate has nothing to ask for — and a gate that asks
 * anyway teaches people to write empty changesets, which is worse than not
 * asking. Dependabot applies this to every pull request it opens.
 *
 * A label rather than a file, and deliberately: it is applied on the pull
 * request where a reviewer is already looking, it cannot be set without leaving
 * a trace in the timeline, and the run that honours it says so in its output.
 * That is the same bargain as every other escape hatch here — usable by
 * somebody explaining themselves, and never silent.
 */
export const SKIP_LABEL = 'skip-changeset';

/** The workflow hands labels over as one comma-separated string, or not at all. */
export const labelsOf = (value: string | undefined): string[] =>
  (value ?? '')
    .split(',')
    .map((label) => label.trim())
    .filter(Boolean);

export type Verdict = { exitCode: 0 | 1; message: string };

export const check = (changed: string[], labels: string[] = []): Verdict => {
  if (!touchesPackage(changed)) {
    return { exitCode: 0, message: 'check-changeset: no publishable change, nothing to require' };
  }
  if (labels.includes(SKIP_LABEL)) {
    return { exitCode: 0, message: `check-changeset: \`${SKIP_LABEL}\` set on this pull request` };
  }
  if (hasChangeset(changed)) {
    return { exitCode: 0, message: 'check-changeset: changeset present' };
  }
  return {
    exitCode: 1,
    message: [
      'check-changeset: this PR changes the published package but adds no changeset.',
      '',
      'Run `pnpm changeset` and commit the file it writes.',
      `If it publishes nothing — a dependency bump, say — label it \`${SKIP_LABEL}\`.`,
    ].join('\n'),
  };
};

/** Returns the process exit code rather than taking it, so tests can call it. */
export const main = (
  env: NodeJS.ProcessEnv = process.env,
  { diff = gitDiff }: { diff?: Differ } = {},
): number => {
  const base = env.BASE_SHA;
  const head = env.HEAD_SHA;

  if (!base || !head) {
    console.error('check-changeset: BASE_SHA and HEAD_SHA must be set');
    return 1;
  }

  const verdict = check(diff(base, head), labelsOf(env.PR_LABELS));
  if (verdict.exitCode === 0) console.log(verdict.message);
  else console.error(verdict.message);
  return verdict.exitCode;
};

/* v8 ignore start -- the entry shell; covered by the test that spawns this
   file, which reports no coverage back into this run. */
if (isEntry(import.meta.url)) {
  process.exit(main());
}
/* v8 ignore stop */
