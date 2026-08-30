/**
 * Packs the real tarball, installs it into a scratch project, and runs the
 * published bin.
 *
 * This is the only check that catches a `files` entry that dropped dist, an
 * exports map that resolves for a bundler but not for plain Node, or a bin that
 * lost its execute bit somewhere between tsup and npm. Every one of those ships
 * green through lint, types and unit tests.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const pkgDir = process.cwd();
const scratch = mkdtempSync(join(tmpdir(), 'patchfinder-pack-'));

function sh(command: string, args: string[], cwd: string): string {
  return execFileSync(command, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

try {
  sh('npm', ['pack', '--pack-destination', scratch], pkgDir);
  const tarball = readdirSync(scratch).find((f) => f.endsWith('.tgz'));
  if (!tarball) throw new Error('npm pack produced no tarball');

  writeFileSync(join(scratch, 'package.json'), JSON.stringify({ name: 'scratch', private: true }));
  sh('npm', ['install', '--no-audit', '--no-fund', join(scratch, tarball)], scratch);

  // The bin, as a consumer gets it.
  const version = sh('npx', ['--no-install', 'patchfinder', '--version'], scratch).trim();
  if (!/^\d+\.\d+\.\d+/.test(version)) {
    throw new Error(`published bin reported an unusable version: ${version}`);
  }

  // The library entry, through the exports map, in plain Node with no bundler.
  const probe = join(scratch, 'probe.mjs');
  writeFileSync(
    probe,
    [
      "import { analyze, RULE_IDS } from 'patchfinder';",
      "const report = analyze({ diff: '' });",
      'if (report.findings.length !== 0) throw new Error("empty diff produced findings");',
      'if (RULE_IDS.length !== 9) throw new Error("rule registry changed shape");',
      "console.log('ok');",
    ].join('\n'),
  );
  const probeOut = sh('node', [probe], scratch).trim();
  if (probeOut !== 'ok') throw new Error(`probe failed: ${probeOut}`);

  console.log(`pack:smoke ok — patchfinder@${version} installs and runs from a tarball`);
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
