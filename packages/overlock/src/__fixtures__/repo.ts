import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

/**
 * A real git repository in a temp directory.
 *
 * The alternative — mocking child_process — would let `resolveRange` pass its
 * tests while being wrong about what git actually prints, which is the only
 * thing it exists to know.
 */
export class TempRepo {
  readonly dir: string;

  constructor() {
    this.dir = mkdtempSync(join(tmpdir(), 'overlock-test-'));
    this.git(['init', '--quiet', '--initial-branch=main']);
    this.git(['config', 'user.email', 'test@example.com']);
    this.git(['config', 'user.name', 'Overlock Tests']);
    this.git(['config', 'commit.gpgsign', 'false']);
  }

  git(args: string[]): string {
    return execFileSync('git', args, {
      cwd: this.dir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  }

  write(relative: string, contents: string): void {
    const file = join(this.dir, relative);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, contents, 'utf8');
  }

  commit(message: string): void {
    this.git(['add', '-A']);
    this.git(['commit', '--quiet', '--no-verify', '-m', message]);
  }

  cleanup(): void {
    rmSync(this.dir, { recursive: true, force: true });
  }
}

export const PASSING_TEST = [
  "import { it, expect } from 'vitest';",
  '',
  "it('rejects expired tokens', () => {",
  '  expect(check()).toBe(false);',
  '});',
  '',
].join('\n');

export const SKIPPED_TEST = PASSING_TEST.replace("it('rejects", "it.skip('rejects");
