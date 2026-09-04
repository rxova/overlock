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

export type Verdict = { exitCode: 0 | 1; message: string };

export const check = (changed: string[]): Verdict => {
  if (!touchesPackage(changed)) {
    return { exitCode: 0, message: 'check-changeset: no publishable change, nothing to require' };
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

  const verdict = check(diff(base, head));
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
