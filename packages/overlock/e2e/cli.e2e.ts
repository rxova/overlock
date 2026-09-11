import { afterEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
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

  it('regrades one rule with --severity, leaving the others alone', () => {
    const r = weakenedRepo();
    const graded = overlock(['check', '--base', 'auto', '--severity', 'TEST_SKIPPED_ADDED=low'], {
      cwd: r.dir,
    });
    expect(graded.status).toBe(0);
    expect(graded.stdout).toContain('LOW');

    const typo = overlock(['check', '--severity', 'TEST_SKIPPED=low'], { cwd: r.dir });
    expect(typo.status).toBe(2);
    expect(typo.stderr).toContain('known rule');
  });

  it('honours an Overlock-Allow trailer in a commit message', () => {
    const committed = (message: string): number => {
      const r = weakenedRepo();
      r.git(['add', '-A']);
      r.git(['commit', '-m', message]);
      // Against the previous commit, so the message just written is in the range.
      const status = overlock(['check', '--base', 'HEAD~1'], { cwd: r.dir }).status;
      // Two repositories in one test, and afterEach only knows about the last.
      r.cleanup();
      return status;
    };

    expect(committed('chore: quarantine the login test')).toBe(1);
    expect(committed('chore: quarantine\n\nOverlock-Allow: TEST_SKIPPED_ADDED -- see #412')).toBe(
      0,
    );
  });

  it('reads Overlock-Allow trailers from --allow-file too', () => {
    const r = weakenedRepo();
    r.write(
      'pr-body.txt',
      'Overlock-Allow: TEST_SKIPPED_ADDED -- rename only, no behaviour change\n',
    );

    const result = overlock(
      ['check', '--base', 'auto', '--allow-file', join(r.dir, 'pr-body.txt')],
      { cwd: r.dir },
    );
    expect(result.status).toBe(0);
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

describe('which patch got examined', () => {
  /** A branch that forked before main moved on, with a test added on main. */
  function forkedRepo(): TempRepo {
    const r = new TempRepo();
    repo = r;
    r.write('src/auth.test.ts', PASSING_TEST);
    r.commit('feat: add auth');

    r.git(['checkout', '--quiet', '-b', 'feature']);
    r.write('src/feature.ts', 'export const x = 1;\n');
    r.commit('feat: a branch that touches no test');

    r.git(['checkout', '--quiet', 'main']);
    r.write('src/billing.test.ts', PASSING_TEST);
    r.commit('feat: a test added on main, after the fork');
    r.git(['checkout', '--quiet', 'feature']);

    return r;
  }

  it('does not report a file main gained as a deletion on this branch', () => {
    const r = forkedRepo();
    const result = overlock(['check', '--base', 'main'], { cwd: r.dir });

    expect(result.status).toBe(0);
    expect(result.stdout).not.toContain('TEST_REMOVED');
    expect(result.stdout).not.toContain('billing.test.ts');
  });

  it('still compares against the ref itself when asked to', () => {
    const r = forkedRepo();
    const result = overlock(['check', '--base', 'main', '--base-mode', 'direct'], { cwd: r.dir });

    expect(result.status).toBe(1);
    expect(result.stdout).toContain('TEST_REMOVED');
  });

  it('rejects a base mode it does not have', () => {
    const r = cleanRepo();
    const result = overlock(['check', '--base-mode', 'sideways'], { cwd: r.dir });
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('--base-mode must be fork-point or direct');
  });

  it('sees work the agent committed, with no ref passed', () => {
    const r = new TempRepo();
    repo = r;
    r.write('src/auth.test.ts', PASSING_TEST);
    r.commit('feat: add auth');
    r.git(['checkout', '--quiet', '-b', 'feature']);
    r.write('src/auth.test.ts', SKIPPED_TEST);
    r.commit('chore: tidy the suite');

    // Nothing is uncommitted, which is exactly the state a pre-push gate runs
    // in. Reporting "clean" here is the failure this covers.
    const result = overlock(['check'], { cwd: r.dir });
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('TEST_SKIPPED_ADDED');
  });

  it('says what it examined on a clean run', () => {
    const r = cleanRepo();
    const result = overlock(['check'], { cwd: r.dir });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('nothing weakened');
    expect(result.stdout).toMatch(/1 file, against/);
  });

  it('does not call an empty patch clean', () => {
    const r = new TempRepo();
    repo = r;
    r.write('src/auth.test.ts', PASSING_TEST);
    r.commit('feat: add auth');
    r.write('src/auth.test.ts', SKIPPED_TEST);
    r.commit('chore: tidy the suite');
    // On the default branch with nothing uncommitted and one commit behind
    // reachable, `auto` still has a patch. Ask for a range that holds nothing.
    // `--no-ledger` because the ledger this harness writes lands inside the
    // repository, and an untracked file is part of the patch — which is the
    // counting working, not a nuisance.
    const result = overlock(['check', '--base', 'HEAD', '--no-ledger'], { cwd: r.dir });

    expect(result.stdout).toContain('nothing to examine');
    expect(result.status).toBe(0);
    expect(
      overlock(['check', '--base', 'HEAD', '--fail-on-empty', '--no-ledger'], { cwd: r.dir })
        .status,
    ).toBe(1);
  });

  it('explains how it chose the base', () => {
    const r = cleanRepo();
    const result = overlock(['check', '--explain-base'], { cwd: r.dir });

    expect(result.stderr).toContain('overlock: base —');
    expect(result.stderr).toContain('auto');
    expect(result.stderr).toContain('the working tree');
  });
});

describe('repository settings', () => {
  it('obeys the file, and says so', () => {
    const r = weakenedRepo();
    r.write('overlock.config.json', JSON.stringify({ failOn: 'none' }));

    // The finding is still reported; the threshold it is measured against is
    // what the file changed.
    const result = overlock(['check'], { cwd: r.dir });
    expect(result.stdout).toContain('TEST_SKIPPED_ADDED');
    expect(result.status).toBe(0);
  });

  it('lets a flag win over the file', () => {
    const r = weakenedRepo();
    r.write('overlock.config.json', JSON.stringify({ failOn: 'none' }));
    expect(overlock(['check', '--fail-on', 'high'], { cwd: r.dir }).status).toBe(1);
  });

  it('can be told to ignore the file', () => {
    const r = weakenedRepo();
    r.write('overlock.config.json', JSON.stringify({ failOn: 'none' }));
    expect(overlock(['check', '--no-config'], { cwd: r.dir }).status).toBe(1);
  });

  it('reads a file it is pointed at', () => {
    const r = weakenedRepo();
    r.write('ci/policy.json', JSON.stringify({ failOn: 'none' }));
    expect(overlock(['check', '--config', 'ci/policy.json'], { cwd: r.dir }).status).toBe(0);
  });

  it('refuses to run on a setting it does not understand', () => {
    const r = weakenedRepo();
    r.write('overlock.config.json', JSON.stringify({ failon: 'none' }));

    const result = overlock(['check'], { cwd: r.dir });
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('unknown setting "failon"');
  });

  it('grades a rule from the file', () => {
    const r = weakenedRepo();
    r.write('overlock.config.json', JSON.stringify({ severity: { TEST_SKIPPED_ADDED: 'low' } }));
    expect(overlock(['check'], { cwd: r.dir }).status).toBe(0);
  });

  it('prints what is in force and where each answer came from', () => {
    const r = cleanRepo();
    r.write('overlock.config.json', JSON.stringify({ failOn: 'medium' }));

    const result = overlock(['config', '--fail-on', 'low'], { cwd: r.dir });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('overlock.config.json');
    expect(result.stdout).toContain('failOn = "low"  (flag)');
    expect(result.stdout).toContain('baseMode = "fork-point"  (default)');
  });

  it('prints the same thing as data', () => {
    const r = cleanRepo();
    r.write('overlock.config.json', JSON.stringify({ failOn: 'medium' }));

    const parsed: unknown = JSON.parse(overlock(['config', '--json'], { cwd: r.dir }).stdout);
    expect(parsed).toMatchObject({
      declared: { failOn: 'medium' },
      effective: { failOn: 'medium', base: 'auto' },
      from: { failOn: 'config', base: 'default' },
    });
  });

  it('says plainly when there is no file at all', () => {
    const r = cleanRepo();
    expect(overlock(['config'], { cwd: r.dir }).stdout).toContain('no config file');
  });

  it('reports the threshold it applied, for whoever renders the result', () => {
    const r = weakenedRepo();
    r.write('overlock.config.json', JSON.stringify({ failOn: 'medium' }));

    const report: unknown = JSON.parse(overlock(['check', '--json'], { cwd: r.dir }).stdout);
    expect(report).toMatchObject({ fail_on: 'medium' });
  });
});

describe('what the agent did this session', () => {
  /** A transcript file, standing in for the one Claude Code writes. */
  function transcript(): string {
    const file = join(mkdtempSync(join(tmpdir(), 'overlock-session-')), 'session.jsonl');
    writeFileSync(file, '{}\n', 'utf8');
    return file;
  }

  /**
   * Well before the session starts. git timestamps are whole seconds, so a test
   * that makes its setup commit in the same second as the commit under test is
   * not testing a boundary at all — it is testing whichever way the rounding
   * fell on that run.
   */
  const EARLIER = new Date(Date.now() - 60 * 60 * 1000);

  it('blocks on a weakening the agent committed before stopping', () => {
    const r = new TempRepo();
    repo = r;
    r.write('src/auth.test.ts', PASSING_TEST);
    r.commit('feat: add auth', { at: EARLIER });

    // The session starts here, and then the agent commits twice and stops —
    // the ordinary workflow the hook used to be blind to. The second commit
    // matters: it puts the weakening out of reach of every fallback, so this
    // can only pass by reading the session.
    const file = transcript();
    r.write('src/auth.test.ts', SKIPPED_TEST);
    r.commit('chore: tidy the suite');
    r.write('README.md', '# docs\n');
    r.commit('docs: unrelated');

    const result = overlock(['hook', 'claude'], {
      cwd: r.dir,
      stdin: JSON.stringify({ transcript_path: file }),
    });

    expect(result.status).toBe(2);
    expect(result.stdout).toContain('blockStopReason');
    expect(result.stderr).toContain('TEST_SKIPPED_ADDED');

    // And without the session, the same repository looks clean — which is the
    // bug, held in place so it cannot come back unnoticed.
    expect(overlock(['check', '--base', 'auto'], { cwd: r.dir }).status).toBe(0);
  });

  it('covers the working tree in the same breath', () => {
    const r = new TempRepo();
    repo = r;
    r.write('src/auth.test.ts', PASSING_TEST);
    r.commit('feat: add auth', { at: EARLIER });

    const file = transcript();
    r.write('src/other.ts', 'export const x = 1;\n');
    r.commit('feat: something committed');
    r.write('src/auth.test.ts', SKIPPED_TEST);

    const result = overlock(['hook', 'claude'], {
      cwd: r.dir,
      stdin: JSON.stringify({ transcript_path: file }),
    });

    expect(result.status).toBe(2);
    expect(result.stderr).toContain('TEST_SKIPPED_ADDED');
  });

  it('reads a trailer from a commit the agent made during the session', () => {
    const r = new TempRepo();
    repo = r;
    r.write('src/auth.test.ts', PASSING_TEST);
    r.commit('feat: add auth', { at: EARLIER });

    const file = transcript();
    r.write('src/auth.test.ts', SKIPPED_TEST);
    r.git(['add', '-A']);
    r.git([
      'commit',
      '--quiet',
      '--no-verify',
      '-m',
      'chore: quarantine the flake\n\nOverlock-Allow: TEST_SKIPPED_ADDED -- flaky, tracked in #412',
    ]);

    const result = overlock(['hook', 'claude'], {
      cwd: r.dir,
      stdin: JSON.stringify({ transcript_path: file }),
    });

    // Allowed, so not blocking on the finding — but the acknowledgement is put
    // in front of the person exactly once, which is the standing behaviour.
    expect(result.stderr).toContain('silenced');
    expect(result.stderr).toContain('flaky, tracked in #412');
  });

  it('falls back to auto when there is no transcript to date the session', () => {
    const r = weakenedRepo();
    const result = overlock(['hook', 'claude'], { cwd: r.dir, stdin: '{}' });

    // The weakening is uncommitted here, which `auto` still covers.
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('TEST_SKIPPED_ADDED');
  });

  it('says the session is where the base came from', () => {
    const r = new TempRepo();
    repo = r;
    r.write('src/auth.test.ts', PASSING_TEST);
    r.commit('feat: add auth', { at: EARLIER });
    const file = transcript();
    r.write('README.md', '# docs\n');
    r.commit('docs: nothing to do with tests');

    const result = overlock(['hook', 'claude', '--explain-base'], {
      cwd: r.dir,
      stdin: JSON.stringify({ transcript_path: file }),
    });

    expect(result.stderr).toContain('overlock: base — this session ->');
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

describe('untracked files', () => {
  it('catches a skipped test in a file git has never seen', () => {
    const r = new TempRepo();
    repo = r;
    r.write('src/auth.ts', 'export const check = () => true;\n');
    r.commit('feat: add auth');
    r.write('src/auth.test.ts', SKIPPED_TEST);

    const result = overlock(['check', '--base', 'auto', '--json'], { cwd: r.dir });
    expect(result.status).toBe(1);

    const report = JSON.parse(result.stdout) as { findings: { rule: string; file: string }[] };
    expect(report.findings[0]).toMatchObject({
      rule: 'TEST_SKIPPED_ADDED',
      file: 'src/auth.test.ts',
    });
  });

  it('leaves the index exactly as it found it', () => {
    const r = new TempRepo();
    repo = r;
    r.write('src/auth.ts', 'export const check = () => true;\n');
    r.commit('feat: add auth');
    r.write('src/auth.test.ts', SKIPPED_TEST);

    // --no-ledger so the harness does not drop its own JSONL into the repo and
    // make an untracked test artefact look like a write.
    const before = r.git(['status', '--porcelain']);
    overlock(['check', '--base', 'auto', '--no-ledger'], { cwd: r.dir });
    expect(r.git(['status', '--porcelain'])).toBe(before);
    expect(r.git(['diff', '--cached', '--name-only'])).toBe('');
  });

  it('can be opted out of', () => {
    const r = new TempRepo();
    repo = r;
    r.write('src/auth.ts', 'export const check = () => true;\n');
    r.commit('feat: add auth');
    r.write('src/auth.test.ts', SKIPPED_TEST);

    expect(overlock(['check', '--base', 'auto', '--no-untracked'], { cwd: r.dir }).status).toBe(0);
  });
});

describe('suppressions', () => {
  function repoWithSuppressedSkip(directive: string): TempRepo {
    const r = new TempRepo();
    repo = r;
    r.write('src/auth.test.ts', PASSING_TEST);
    r.commit('feat: add auth tests');
    r.write('src/auth.test.ts', SKIPPED_TEST.replace('it.skip', `${directive}\nit.skip`));
    return r;
  }

  it('silences a finding when a reason is given, and says it did', () => {
    const r = repoWithSuppressedSkip(
      '// overlock-ignore TEST_SKIPPED_ADDED -- quarantined, see #412',
    );
    const result = overlock(['check', '--base', 'auto'], { cwd: r.dir });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('1 suppressed');
  });

  it('silences nothing when the reason is missing', () => {
    const r = repoWithSuppressedSkip('// overlock-ignore TEST_SKIPPED_ADDED');
    expect(overlock(['check', '--base', 'auto'], { cwd: r.dir }).status).toBe(1);
  });

  it('silences nothing when the rule does not match', () => {
    const r = repoWithSuppressedSkip('// overlock-ignore ASSERTION_REMOVED -- wrong rule');
    expect(overlock(['check', '--base', 'auto'], { cwd: r.dir }).status).toBe(1);
  });

  // This case previously asserted an exit 0, which is exactly the hole: a patch
  // that writes its own directive passed the hook in silence.
  it('stops the hook once for a directive the patch itself added', () => {
    const r = repoWithSuppressedSkip(
      '// overlock-ignore TEST_SKIPPED_ADDED -- quarantined, see #412',
    );
    expect(overlock(['hook', 'claude'], { cwd: r.dir, stdin: '{}' }).status).toBe(2);

    const line = readFileSync(join(r.dir, '.overlock-ledger.jsonl'), 'utf8').trim();
    expect(JSON.parse(line)).toMatchObject({ ok: true, suppressed: 1 });
  });

  it('says nothing about a directive that was already in the tree', () => {
    const r = new TempRepo();
    repo = r;
    // The directive is committed first, so the patch under review only adds the
    // skip it covers — a decision somebody already made and reviewed.
    r.write(
      'src/auth.test.ts',
      PASSING_TEST.replace(
        "it('rejects",
        "// overlock-ignore TEST_SKIPPED_ADDED -- quarantined, see #412\nit('rejects",
      ),
    );
    r.commit('test: quarantine the expiry case');
    r.write(
      'src/auth.test.ts',
      readFileSync(join(r.dir, 'src/auth.test.ts'), 'utf8').replace(
        "it('rejects",
        "it.skip('rejects",
      ),
    );

    const result = overlock(['hook', 'claude'], { cwd: r.dir, stdin: '{}' });
    expect(result.status).toBe(0);
    expect(result.stdout).toBe('');
  });
});

describe('overlock report', () => {
  it('reads back what the ledger recorded, and always exits 0', () => {
    const r = new TempRepo();
    repo = r;
    r.write('src/auth.test.ts', PASSING_TEST);
    r.commit('feat: add auth tests');
    r.write('src/auth.test.ts', SKIPPED_TEST);

    overlock(['check', '--base', 'auto'], { cwd: r.dir });
    overlock(['check', '--base', 'auto'], { cwd: r.dir });

    const result = overlock(['report'], { cwd: r.dir });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('2 runs');
    expect(result.stdout).toContain('TEST_SKIPPED_ADDED');
  });

  it('says what to do when there is nothing recorded yet', () => {
    const r = cleanRepo();
    const result = overlock(['report', '--days', '1'], { cwd: r.dir });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('nothing recorded');
  });

  it('emits the aggregate as data', () => {
    const r = new TempRepo();
    repo = r;
    r.write('src/auth.test.ts', PASSING_TEST);
    r.commit('feat: add auth tests');
    r.write('src/auth.test.ts', SKIPPED_TEST);
    overlock(['check', '--base', 'auto'], { cwd: r.dir });

    const summary = JSON.parse(overlock(['report', '--json'], { cwd: r.dir }).stdout) as {
      runs: number;
      caught: number;
      byRule: { rule: string }[];
    };
    expect(summary.runs).toBe(1);
    expect(summary.caught).toBe(1);
    expect(summary.byRule[0]?.rule).toBe('TEST_SKIPPED_ADDED');
  });

  it('rejects a nonsense window', () => {
    const r = cleanRepo();
    const result = overlock(['report', '--days', '0'], { cwd: r.dir });
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('positive integer');
  });
});

describe('an agent trying to get to green', () => {
  function repoWithSkip(extraLine = ''): TempRepo {
    const r = new TempRepo();
    repo = r;
    r.write('src/auth.test.ts', PASSING_TEST);
    r.commit('feat: add auth tests');
    r.write(
      'src/auth.test.ts',
      SKIPPED_TEST.replace('it.skip', `${extraLine}\nit.skip`.trimStart()),
    );
    return r;
  }

  // The gate's whole claim is that an agent cannot reach "done" by editing the
  // check. Writing its own suppression and exiting 0 in silence was exactly
  // that, and from a phone it looked identical to a clean run.
  it('cannot silence its own finding and slip past the hook', () => {
    const r = repoWithSkip('// overlock-ignore TEST_SKIPPED_ADDED -- flaky');
    const result = overlock(['hook', 'claude'], { cwd: r.dir, stdin: '{}' });

    expect(result.status).toBe(2);
    expect(result.stderr).toContain('silenced 1 of its own findings');
    expect(result.stderr).toContain('flaky');
  });

  it('is let through once the person has seen the claim', () => {
    const r = repoWithSkip('// overlock-ignore TEST_SKIPPED_ADDED -- flaky');
    const result = overlock(['hook', 'claude'], {
      cwd: r.dir,
      stdin: JSON.stringify({ stop_hook_active: true }),
    });

    expect(result.status).toBe(0);
  });

  it('cannot smuggle a directive inside a string literal', () => {
    const r = repoWithSkip('const doc = "write // overlock-ignore TEST_SKIPPED_ADDED -- like so";');
    expect(overlock(['check', '--base', 'auto'], { cwd: r.dir }).status).toBe(1);
  });

  it('cannot hide a marker by splitting it over two lines', () => {
    const r = new TempRepo();
    repo = r;
    r.write('src/auth.test.ts', PASSING_TEST);
    r.commit('feat: add auth tests');
    r.write('src/auth.test.ts', PASSING_TEST.replace("it('rejects", "it\n  .skip('rejects"));

    expect(overlock(['check', '--base', 'auto'], { cwd: r.dir }).status).toBe(1);
  });

  it('works in a repository that has never been committed to', () => {
    const r = new TempRepo();
    repo = r;
    r.write('src/auth.test.ts', SKIPPED_TEST);

    const result = overlock(['check', '--base', 'auto'], { cwd: r.dir });
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('no commits yet');
    expect(result.stdout).not.toContain('git repository');
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

describe('portable evaluation', () => {
  it('records one event per analysis and excludes its own records on repeat checks', () => {
    const r = weakenedRepo();
    r.write(
      'overlock.config.json',
      JSON.stringify({ base: 'HEAD', evaluation: { repository: 'team/repo', captureDiff: true } }),
    );
    const first = overlock(['check', '--no-ledger', '--json'], { cwd: r.dir });
    const second = overlock(['check', '--no-ledger', '--json'], { cwd: r.dir });
    expect(first.status).toBe(1);
    expect(second.stdout).toBe(first.stdout);
    const result = overlock(['evaluate', '--json'], { cwd: r.dir });
    const summary = JSON.parse(result.stdout) as {
      runs: number;
      distinct_findings: number;
      builds: string[];
      useful_corrections: number;
    };
    expect(summary.runs).toBe(2);
    expect(summary.distinct_findings).toBe(1);
    expect(summary.useful_corrections).toBe(0);
    expect(summary.builds[0]).not.toContain('source');
    expect(overlock(['evaluate'], { cwd: r.dir }).stdout).toContain('Unreviewed');
    expect(overlock(['check', '--no-ledger', '--no-evaluation'], { cwd: r.dir }).status).toBe(1);
    expect(readdirSync(join(r.dir, '.overlock/runs'))).toHaveLength(2);
    const file = readdirSync(join(r.dir, '.overlock/runs'))[0]!;
    expect(overlock(['import', '.overlock/runs/' + file], { cwd: r.dir }).status).toBe(0);
    expect(
      (JSON.parse(overlock(['evaluate', '--json'], { cwd: r.dir }).stdout) as { runs: number })
        .runs,
    ).toBe(2);
    const manifest = {
      schema: 1,
      cases: [
        {
          id: 'captured',
          kind: 'historical',
          split: 'holdout',
          expected: null,
          diff: 'patches/' + readdirSync(join(r.dir, '.overlock/patches'))[0]!,
        },
      ],
    };
    r.write('.overlock/manifest.json', JSON.stringify(manifest));
    expect(overlock(['replay', '.overlock/manifest.json'], { cwd: r.dir }).status).toBe(0);
  });

  it('records a retry bypass and counts suppression blocks in the legacy ledger accurately', () => {
    const r = weakenedRepo();
    r.write(
      'overlock.config.json',
      JSON.stringify({ base: 'HEAD', evaluation: { repository: 'team/repo' } }),
    );
    expect(
      overlock(['hook', 'claude'], {
        cwd: r.dir,
        stdin: JSON.stringify({ session_id: 'session', stop_hook_active: true }),
      }).status,
    ).toBe(0);
    const file = readdirSync(join(r.dir, '.overlock/runs'))[0]!;
    expect(JSON.parse(readFileSync(join(r.dir, '.overlock/runs', file), 'utf8'))).toMatchObject({
      decision: 'retry_bypass',
      exit_code: 0,
    });
    expect(JSON.parse(readFileSync(join(r.dir, '.overlock-ledger.jsonl'), 'utf8'))).toMatchObject({
      blocked: false,
    });
    r.write(
      'src/auth.test.ts',
      '// overlock-ignore TEST_SKIPPED_ADDED -- probe\n' + "it.skip('probe', () => {});\n",
    );
    expect(overlock(['hook', 'claude'], { cwd: r.dir }).status).toBe(2);
    const legacy = readFileSync(join(r.dir, '.overlock-ledger.jsonl'), 'utf8').trim().split('\n');
    expect(JSON.parse(legacy.at(-1)!)).toMatchObject({ blocked: true, ok: true });
  });

  it('rejects missing import and replay inputs without producing evaluation events', () => {
    const r = cleanRepo();
    expect(overlock(['replay'], { cwd: r.dir }).status).toBe(2);
    expect(overlock(['import'], { cwd: r.dir }).status).toBe(2);
  });
});
