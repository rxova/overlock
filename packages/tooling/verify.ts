/**
 * The pre-push gate: the same ordered list CI runs, so a green push means a
 * green pipeline. Turbo replays whatever this commit did not touch, so a
 * re-push after a prose-only edit finishes in seconds.
 *
 * E2E is deliberately absent — it spawns real git repositories and takes long
 * enough that putting it here would train people to use --no-verify.
 */
import { execSync } from 'node:child_process';

const steps: [name: string, command: string][] = [
  ['lint', 'pnpm lint'],
  ['format', 'pnpm format:check'],
  ['build', 'pnpm exec turbo run build'],
  ['typecheck', 'pnpm exec turbo run typecheck'],
  ['unit tests', 'pnpm exec turbo run test'],
  ['package exports', 'pnpm run check:exports'],
  ['dependency dedupe', 'pnpm run dedupe:check'],
  ['audit', 'pnpm run audit:check'],
];

for (const [name, command] of steps) {
  process.stdout.write(`\nverify: ${name}\n`);
  try {
    execSync(command, { stdio: 'inherit' });
  } catch {
    process.stderr.write(`\nverify: ${name} failed\n`);
    process.exit(1);
  }
}

process.stdout.write('\nverify: all checks passed\n');
