import { afterEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { PASSING_TEST, SKIPPED_TEST, TempRepo } from '../src/__fixtures__/repo.js';

/**
 * The built binary, exactly as npm installs it. Not the TypeScript source and
 * not an in-process call: the things this suite exists to catch — a bad exit
 * code, a hook that writes its JSON to the wrong stream, a shebang that never
 * made it through the build — are all invisible when you import a function.
 */
const CLI = fileURLToPath(new URL('../dist/cli.js', import.meta.url));

let repo: TempRepo | null = null;

afterEach(() => {
  repo?.cleanup();
  repo = null;
});

interface RunResult {
  status: number;
  stdout: string;
  stderr: string;
}

function overlock(
  args: string[],
  options: { cwd: string; stdin?: string } = { cwd: '.' },
): RunResult {
  const result = spawnSync(process.execPath, [CLI, ...args], {
    cwd: options.cwd,
    encoding: 'utf8',
    input: options.stdin ?? '',
    env: {
      ...process.env,
      // Never touch the developer's real ledger from a test run.
      OVERLOCK_LEDGER: join(options.cwd, '.overlock-ledger.jsonl'),
      NO_COLOR: '1',
    },
  });

  return { status: result.status ?? -1, stdout: result.stdout, stderr: result.stderr };
}

function weakenedRepo(): TempRepo {
  const r = new TempRepo();
  repo = r;
  r.write('src/auth.test.ts', PASSING_TEST);
  r.write('src/auth.ts', 'export const check = () => false;\n');
  r.commit('feat: add auth');
  r.write('src/auth.test.ts', SKIPPED_TEST);
  return r;
}

function cleanRepo(): TempRepo {
  const r = new TempRepo();
  repo = r;
  r.write('src/auth.test.ts', PASSING_TEST);
  r.commit('feat: add auth');
  r.write('README.md', '# docs\n');
  return r;
}

describe('overlock check', () => {
  it('exits 1 and names the rule when a test was skipped', () => {
    const r = weakenedRepo();
    const result = overlock(['check', '--base', 'auto'], { cwd: r.dir });

    expect(result.status).toBe(1);
    expect(result.stdout).toContain('TEST_SKIPPED_ADDED');
    expect(result.stdout).toContain('src/auth.test.ts');
  });

  it('exits 0 on a patch that touches no tests', () => {
    const r = cleanRepo();
    const result = overlock(['check', '--base', 'auto'], { cwd: r.dir });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('nothing weakened');
  });

  it('emits a parseable report under --json', () => {
    const r = weakenedRepo();
    const result = overlock(['check', '--base', 'auto', '--json'], { cwd: r.dir });

    const report = JSON.parse(result.stdout) as {
      schema: number;
      ok: boolean;
      findings: { rule: string; fix_hint: string; evidence: { after?: string } }[];
    };
    expect(report.schema).toBe(1);
    expect(report.ok).toBe(false);
    expect(report.findings[0]?.rule).toBe('TEST_SKIPPED_ADDED');
    expect(report.findings[0]?.fix_hint).toBeTruthy();
    expect(report.findings[0]?.evidence.after).toContain('it.skip');
  });

  it('keeps --compact short enough to read on a phone', () => {
    const r = weakenedRepo();
    const result = overlock(['check', '--base', 'auto', '--compact'], { cwd: r.dir });

    const lines = result.stdout.trim().split('\n');
    expect(lines.length).toBeLessThanOrEqual(12);
    expect(lines.every((l) => l.length <= 120)).toBe(true);
    expect(result.stdout).toContain('overlock:');
  });

  it('respects --fail-on', () => {
    const r = weakenedRepo();
    expect(overlock(['check', '--base', 'auto', '--fail-on', 'none'], { cwd: r.dir }).status).toBe(
      0,
    );
  });

  it('checks only what is staged with --staged', () => {
    const r = weakenedRepo();
    expect(overlock(['check', '--staged'], { cwd: r.dir }).status).toBe(0);

    r.git(['add', '-A']);
    expect(overlock(['check', '--staged'], { cwd: r.dir }).status).toBe(1);
  });

  it('writes one ledger line per run', () => {
    const r = weakenedRepo();
    overlock(['check', '--base', 'auto'], { cwd: r.dir });
    overlock(['check', '--base', 'auto'], { cwd: r.dir });

    const lines = readFileSync(join(r.dir, '.overlock-ledger.jsonl'), 'utf8').trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0] as string)).toMatchObject({ mode: 'check', ok: false });
  });

  it('exits 2 with a usable message outside a repository', () => {
    const result = overlock(['check'], { cwd: '/' });
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('git repository');
  });

  it('exits 2 on an unknown option and prints usage', () => {
    const r = cleanRepo();
    const result = overlock(['check', '--nope'], { cwd: r.dir });
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('Unknown option');
    expect(result.stderr).toContain('USAGE');
  });

  it('answers --version and --help without a repository', () => {
    expect(overlock(['--version'], { cwd: '/' }).stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
    expect(overlock(['--help'], { cwd: '/' }).stdout).toContain('USAGE');
  });
});

describe('overlock hook claude', () => {
  it('blocks with exit 2 and the documented JSON on stdout', () => {
    const r = weakenedRepo();
    const result = overlock(['hook', 'claude'], { cwd: r.dir, stdin: '{}' });

    expect(result.status).toBe(2);

    const parsed = JSON.parse(result.stdout) as {
      hookSpecificOutput: { hookEventName: string; blockStopReason: string };
    };
    expect(parsed.hookSpecificOutput.hookEventName).toBe('Stop');
    expect(parsed.hookSpecificOutput.blockStopReason).toContain('TEST_SKIPPED_ADDED');
    expect(result.stderr).toContain('TEST_SKIPPED_ADDED');
  });

  it('says nothing and exits 0 when the patch is clean', () => {
    const r = cleanRepo();
    const result = overlock(['hook', 'claude'], { cwd: r.dir, stdin: '{}' });

    expect(result.status).toBe(0);
    expect(result.stdout).toBe('');
  });

  it('does not block twice — an unfixable finding must not loop the agent', () => {
    const r = weakenedRepo();
    const result = overlock(['hook', 'claude'], {
      cwd: r.dir,
      stdin: JSON.stringify({ stop_hook_active: true }),
    });

    expect(result.status).toBe(0);
    expect(result.stderr).toContain('not blocking again');
  });

  it('still works when the payload is absent or malformed', () => {
    const r = weakenedRepo();
    expect(overlock(['hook', 'claude'], { cwd: r.dir, stdin: '' }).status).toBe(2);
    expect(overlock(['hook', 'claude'], { cwd: r.dir, stdin: 'garbage' }).status).toBe(2);
  });

  it('records the run as a hook that blocked', () => {
    const r = weakenedRepo();
    overlock(['hook', 'claude'], { cwd: r.dir, stdin: '{}' });

    const line = readFileSync(join(r.dir, '.overlock-ledger.jsonl'), 'utf8').trim();
    expect(JSON.parse(line)).toMatchObject({ mode: 'hook', blocked: true });
  });
});

describe('overlock init claude', () => {
  it('writes a committable settings file that the hook then reads', () => {
    const r = cleanRepo();
    const result = overlock(['init', 'claude'], { cwd: r.dir });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('.claude/settings.json');
    expect(result.stdout).toContain('never from ~/.claude');

    const settings = JSON.parse(readFileSync(join(r.dir, '.claude', 'settings.json'), 'utf8')) as {
      hooks: { Stop: { hooks: { command: string }[] }[] };
    };
    expect(settings.hooks.Stop[0]?.hooks[0]?.command).toContain('overlock hook claude');
  });

  it('rejects an unknown agent', () => {
    const r = cleanRepo();
    const result = overlock(['init', 'emacs'], { cwd: r.dir });
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('claude');
  });
});

describe('the whole loop', () => {
  it('goes red on a weakened test and green once it is restored', () => {
    const r = weakenedRepo();
    expect(overlock(['hook', 'claude'], { cwd: r.dir, stdin: '{}' }).status).toBe(2);

    // The agent does the right thing: unskip rather than delete.
    r.write('src/auth.test.ts', PASSING_TEST);
    expect(overlock(['hook', 'claude'], { cwd: r.dir, stdin: '{}' }).status).toBe(0);
  });

  it('catches the second move too, when a lowered threshold replaces the skip', () => {
    const r = new TempRepo();
    repo = r;
    r.write('vitest.config.ts', 'export default { test: { coverage: { statements: 95 } } };\n');
    r.commit('chore: coverage gate');
    r.write('vitest.config.ts', 'export default { test: { coverage: { statements: 20 } } };\n');

    const result = overlock(['check', '--base', 'auto', '--json'], { cwd: r.dir });
    const report = JSON.parse(result.stdout) as { findings: { rule: string }[] };
    expect(report.findings.map((f) => f.rule)).toContain('COVERAGE_THRESHOLD_LOWERED');
  });
});
