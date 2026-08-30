/**
 * A change to the published package needs a changeset, or the release goes out
 * with an empty changelog and an unchanged version.
 *
 * Docs, CI config and the tooling package are exempt: they ship nothing.
 */
import { execFileSync } from 'node:child_process';

const base = process.env.BASE_SHA;
const head = process.env.HEAD_SHA;

if (!base || !head) {
  console.error('check-changeset: BASE_SHA and HEAD_SHA must be set');
  process.exit(1);
}

const changed = execFileSync('git', ['diff', '--name-only', `${base}...${head}`], {
  encoding: 'utf8',
})
  .split('\n')
  .filter(Boolean);

const touchesPackage = changed.some(
  (file) =>
    file.startsWith('packages/patchfinder/') &&
    !file.endsWith('.md') &&
    !file.includes('/e2e/') &&
    !file.endsWith('.test.ts'),
);

const hasChangeset = changed.some(
  (file) => file.startsWith('.changeset/') && file.endsWith('.md') && !file.endsWith('README.md'),
);

if (!touchesPackage) {
  console.log('check-changeset: no publishable change, nothing to require');
  process.exit(0);
}

if (hasChangeset) {
  console.log('check-changeset: changeset present');
  process.exit(0);
}

console.error(
  [
    'check-changeset: this PR changes the published package but adds no changeset.',
    '',
    'Run `pnpm changeset` and commit the file it writes.',
  ].join('\n'),
);
process.exit(1);
