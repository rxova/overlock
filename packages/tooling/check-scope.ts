/**
 * Decides whether an event actually changed anything a test could fail on, and
 * reports it as the `code-changed` output the rest of the workflow gates on.
 *
 * Two kinds of event reach CI without moving the tree in any meaningful way:
 *
 * 1. Metadata actions — `edited`, `labeled`, `unlabeled` — leave HEAD exactly
 *    where it was. The workflow recognises those before this script runs,
 *    because they need no checkout.
 * 2. The release commit. `changeset version` bumps a version field, writes a
 *    changelog and consumes the changeset files. The source tree is otherwise
 *    byte-identical to a parent CI already proved green, so re-running unit
 *    tests on two Node versions, e2e on three operating systems and the Node 20
 *    compatibility job re-derives a verdict that commit already carries.
 *
 * The release commit is recognised by its file set, never by its branch name or
 * its subject line, both of which anyone can write. A `package.json` counts only
 * when the edited lines are its version and nothing else, so a commit that
 * slipped a dependency in beside the bump still runs the full suite.
 *
 * Every uncertain case resolves to running everything. Skipping is the
 * dangerous answer, so it is only ever reached deliberately.
 */
import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';

const base = process.env.BASE_SHA;
const head = process.env.HEAD_SHA;

const git = (...args: string[]): string =>
  execFileSync('git', args, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });

/** True when the only edited lines in a file are its `"version":` line. */
const versionBumpOnly = (file: string): boolean => {
  const edits = git('diff', '--unified=0', `${base}...${head}`, '--', file)
    .split('\n')
    .filter((line) => /^[+-]/.test(line) && !/^(\+\+\+|---)/.test(line));
  return edits.length > 0 && edits.every((line) => /^[+-]\s*"version":\s*"[^"]*",?\s*$/.test(line));
};

/** True when a path only ever carries release bookkeeping. */
const isReleaseMetadata = (file: string): boolean =>
  (file.startsWith('.changeset/') && file.endsWith('.md')) ||
  file === 'CHANGELOG.md' ||
  file.endsWith('/CHANGELOG.md');

const verdict = ((): { codeChanged: boolean; reason: string } => {
  // An initial push reports an all-zero `before`, and a force-push can report a
  // commit that is no longer reachable. Neither is a licence to skip.
  if (!base || !head || /^0+$/.test(base)) {
    return { codeChanged: true, reason: 'no usable commit range' };
  }

  let changed: string[];
  try {
    changed = git('diff', '--name-only', `${base}...${head}`).split('\n').filter(Boolean);
  } catch {
    return { codeChanged: true, reason: 'could not diff the range' };
  }

  if (changed.length === 0) return { codeChanged: true, reason: 'empty diff' };

  const releaseOnly = changed.every((file) => {
    if (isReleaseMetadata(file)) return true;
    if (file === 'package.json' || file.endsWith('/package.json')) return versionBumpOnly(file);
    return false;
  });

  return releaseOnly
    ? {
        codeChanged: false,
        reason: `release commit — ${changed.length} file(s), version and changelog only`,
      }
    : { codeChanged: true, reason: `${changed.length} file(s) changed` };
})();

console.log(`check-scope: ${verdict.reason}`);
console.log(`check-scope: code-changed=${verdict.codeChanged}`);

if (process.env.GITHUB_OUTPUT) {
  appendFileSync(process.env.GITHUB_OUTPUT, `code-changed=${verdict.codeChanged}\n`);
}
