import { afterEach, expect, it, vi } from 'vitest';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { TempRepo, PASSING_TEST, SKIPPED_TEST } from './__fixtures__/repo.js';
import { run } from './run.js';
import {
  evaluationIdentity,
  captureEvaluationDiff,
  type EvaluationRun,
} from './evaluation-record.js';
import { parseConfig } from './config.js';

let repo: TempRepo | undefined;
afterEach(() => {
  repo?.cleanup();
});

it('records the actual retry decision and keeps recording out of the analyzed patch', () => {
  repo = new TempRepo();
  repo.write('a.test.ts', PASSING_TEST);
  repo.commit('initial');
  repo.write('a.test.ts', SKIPPED_TEST);
  const options = {
    cwd: repo.dir,
    base: 'HEAD',
    ledger: false,
    evaluation: { repository: 'fixture' },
    env: { OVERLOCK_SESSION_ID: 'session/one' },
  };
  const first = run({ ...options, mode: 'hook', stopPayload: { stop_hook_active: true } });
  const second = run(options);
  expect(first.outcome?.exitCode).toBe(0);
  expect(first.report.scope?.files).toBe(1);
  expect(second.report.scope?.files).toBe(1);
  const files = readdirSync(join(repo.dir, '.overlock/runs'));
  expect(files).toHaveLength(1);
  const records = readFileSync(join(repo.dir, '.overlock/runs', files[0]!), 'utf8')
    .trim()
    .split('\n')
    .map((s) => JSON.parse(s) as EvaluationRun);
  expect(records[0]?.decision).toBe('retry_bypass');
  expect(records[0]?.patch).toBe(records[1]?.patch);
  expect(records[0]?.findings[0]?.key).toBe(records[1]?.findings[0]?.key);
  expect(records[0]?.repository).toBe('fixture');
  expect(JSON.stringify(records)).not.toContain(repo.dir);
});

it('records errors and self-suppression blocks, and retains the suppressed evidence', () => {
  repo = new TempRepo();
  repo.write('a.test.ts', PASSING_TEST);
  repo.commit('initial');
  repo.write(
    'a.test.ts',
    '// overlock-ignore TEST_SKIPPED_ADDED -- deliberate probe\n' + "it.skip('probe', () => {});\n",
  );
  const options = {
    cwd: repo.dir,
    base: 'HEAD',
    ledger: false,
    evaluation: { repository: 'fixture' },
    env: { OVERLOCK_SESSION_ID: 'test', OVERLOCK_SOURCE: 'probe' },
  };
  expect(run({ ...options, mode: 'hook' }).outcome?.exitCode).toBe(2);
  expect(() => run({ ...options, base: 'missing-ref' })).toThrow();
  const file = readdirSync(join(repo.dir, '.overlock/runs'))[0]!;
  const rows = readFileSync(join(repo.dir, '.overlock/runs', file), 'utf8')
    .trim()
    .split('\n')
    .map((s) => JSON.parse(s) as EvaluationRun);
  expect(rows[0]?.decision).toBe('suppression_block');
  expect(rows[0]?.findings.some((f) => f.disposition === 'suppressed')).toBe(true);
  expect(rows[0]?.source).toBe('probe');
  expect(rows[1]?.status).toBe('error');
  expect(rows[1]?.exit_code).toBe(2);
});

it('validates opt-in repository configuration and preserves captured uncommitted diffs', () => {
  expect(
    parseConfig({ evaluation: { repository: 'team/repo', captureDiff: true } }, 'config'),
  ).toEqual({ evaluation: { repository: 'team/repo', captureDiff: true } });
  expect(
    parseConfig({ evaluation: { repository: 'team/repo' } }, 'config').evaluation?.repository,
  ).toBe('team/repo');
  for (const value of [
    null,
    'yes',
    {},
    { repository: '' },
    { repository: '/path' },
    { repository: 'repo', captureDiff: 'yes' },
    { repository: 'repo', typo: true },
  ]) {
    expect(() => parseConfig({ evaluation: value }, 'config')).toThrow(/evaluation/);
  }
  repo = new TempRepo();
  repo.write('a.test.ts', PASSING_TEST);
  repo.commit('initial');
  repo.write('a.test.ts', SKIPPED_TEST);
  run({
    cwd: repo.dir,
    base: 'HEAD',
    ledger: false,
    evaluation: { repository: 'repo', captureDiff: true },
    testGlobs: [/custom/],
    severities: { TEST_SKIPPED_ADDED: 'off' },
  });
  const file = readdirSync(join(repo.dir, '.overlock/patches'))[0]!;
  expect(readFileSync(join(repo.dir, '.overlock/patches', file), 'utf8')).toContain('it.skip');
  const runFile = readdirSync(join(repo.dir, '.overlock/runs'))[0]!;
  const data = JSON.parse(
    readFileSync(join(repo.dir, '.overlock/runs', runFile), 'utf8'),
  ) as EvaluationRun;
  expect(data.findings[0]?.disposition).toBe('off');
  expect(data.settings.testGlob).toEqual(['custom']);
});

it('records the exclusions, and keeps a sibling tool out of the fingerprint and the snapshot', () => {
  repo = new TempRepo();
  repo.write('a.test.ts', PASSING_TEST);
  repo.commit('initial');
  repo.write('a.test.ts', SKIPPED_TEST);
  const options = {
    cwd: repo.dir,
    base: 'HEAD',
    ledger: false,
    evaluation: { repository: 'repo', captureDiff: true },
    env: { OVERLOCK_SESSION_ID: 'excluded' },
    exclude: ['.basting'],
  };
  run(options);
  // The sibling records its own turn, which used to change this patch's identity
  // and put its snapshot inside the next overlock snapshot.
  repo.write('.basting/runs/s.jsonl', '{"turn":1}\n');
  repo.write('.basting/patches/p.diff', 'diff --git a/x b/x\n');
  run(options);
  run({ ...options, exclude: [] });

  const runFile = readdirSync(join(repo.dir, '.overlock/runs'))[0]!;
  const rows = readFileSync(join(repo.dir, '.overlock/runs', runFile), 'utf8')
    .trim()
    .split('\n')
    .map((s) => JSON.parse(s) as EvaluationRun);
  expect(rows.map((r) => r.settings.exclude)).toEqual([['.basting'], ['.basting'], []]);
  expect(rows[0]?.patch).toBe(rows[1]?.patch);
  expect(rows[2]?.patch).not.toBe(rows[1]?.patch);

  const snapshot = readFileSync(
    join(repo.dir, '.overlock/patches', `${rows[1]!.patch}.diff`),
    'utf8',
  );
  expect(snapshot).toContain('it.skip');
  expect(snapshot).not.toContain('.basting');
});

it('uses portable session identities and explicit environment overrides', () => {
  expect(evaluationIdentity({ CI: 'true' }, 'session').environment).toBe('ci');
  expect(evaluationIdentity({ container: 'docker' }, 'session').environment).toBe('container');
  expect(evaluationIdentity({ OVERLOCK_ENVIRONMENT: 'remote-linux' }).environment).toBe(
    'remote-linux',
  );
  expect(evaluationIdentity({}, 'session').session).toBe(evaluationIdentity({}, 'session').session);
  expect(evaluationIdentity({}).session).not.toBe(evaluationIdentity({}).session);
});

it('warns on persistence failure without changing the gate outcome', () => {
  repo = new TempRepo();
  repo.write('a.test.ts', PASSING_TEST);
  repo.commit('initial');
  writeFileSync(join(repo.dir, '.overlock'), 'blocked');
  const warnings: string[] = [];
  captureEvaluationDiff(repo.dir, 'patch', (message) => warnings.push(message));
  expect(
    run({
      cwd: repo.dir,
      base: 'HEAD',
      ledger: false,
      evaluation: { repository: 'repo' },
      warn: (message) => warnings.push(message),
    }).exitCode,
  ).toBe(0);
  expect(warnings.join('')).toContain('record could not be saved');
  expect(warnings.join('')).toContain('diff could not be saved');
  const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  vi.stubEnv('OVERLOCK_LEDGER', join(repo.dir, '.overlock/legacy.jsonl'));
  try {
    run({ cwd: repo.dir, base: 'HEAD' });
    expect(stderr).toHaveBeenCalledWith('overlock: legacy ledger could not be saved.\n');
  } finally {
    stderr.mockRestore();
    vi.unstubAllEnvs();
  }
});

it('records empty and staged checks, changed settings, and clean hook completion', () => {
  repo = new TempRepo();
  repo.write('a.test.ts', PASSING_TEST);
  repo.commit('initial');
  const options = {
    cwd: repo.dir,
    base: 'HEAD',
    ledger: false,
    evaluation: { repository: 'repo' },
    env: { OVERLOCK_SESSION_ID: 'one', CI: 'true' },
  };
  expect(run({ ...options, failOnEmpty: true }).exitCode).toBe(1);
  expect(run({ ...options, mode: 'hook' }).outcome?.exitCode).toBe(0);
  repo.write('a.test.ts', SKIPPED_TEST);
  repo.git(['add', 'a.test.ts']);
  expect(run({ ...options, staged: true, source: 'mcp' }).exitCode).toBe(1);
  expect(
    run({ ...options, severities: { TEST_SKIPPED_ADDED: 'medium' }, failOn: 'none' }).exitCode,
  ).toBe(0);
});
