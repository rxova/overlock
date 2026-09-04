/**
 * The point of this suite is the classification: a green audit, a red audit and
 * a registry outage all have to stay told apart, because the whole change is
 * worthless if the third one ever starts swallowing the second.
 */
import { EventEmitter } from 'node:events';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  annotate,
  decide,
  main,
  parseLevel,
  parseReport,
  runAudit,
  type AuditRun,
  type Spawner,
} from './audit.js';

/** An `AuditRun` with the fields a case does not care about filled in. */
const run = (fields: Partial<AuditRun> = {}): AuditRun => ({
  stdout: '',
  stderr: '',
  code: 0,
  timedOut: false,
  ...fields,
});

const report = (
  vulnerabilities: Record<string, number>,
  advisories: Record<string, unknown> = {},
): string => JSON.stringify({ advisories, metadata: { vulnerabilities } });

describe('parseLevel', () => {
  it('defaults to high when the flag is absent', () => {
    expect(parseLevel([])).toBe('high');
    expect(parseLevel(['--json'])).toBe('high');
  });

  it.each(['info', 'low', 'moderate', 'high', 'critical'])('accepts %s', (level) => {
    expect(parseLevel([`--audit-level=${level}`])).toBe(level);
  });

  it('rejects a severity that is not one', () => {
    expect(parseLevel(['--audit-level=catastrophic'])).toBeUndefined();
    expect(parseLevel(['--audit-level='])).toBeUndefined();
  });
});

describe('parseReport', () => {
  it('reads a report that is the whole stream', () => {
    expect(parseReport('{"metadata":{}}')).toEqual({ metadata: {} });
  });

  it('finds the report under a banner pnpm printed first', () => {
    const stdout = `Progress: resolved 500\n${report({ high: 0 })}\ndone\n`;
    expect(parseReport(stdout)?.metadata?.vulnerabilities).toEqual({ high: 0 });
  });

  it('returns nothing when there is no object at all', () => {
    expect(parseReport('')).toBeUndefined();
    expect(parseReport('ERR_PNPM_AUDIT_BAD_RESPONSE')).toBeUndefined();
    expect(parseReport('} {')).toBeUndefined();
  });

  it('returns nothing when the object does not parse', () => {
    expect(parseReport('{ not json }')).toBeUndefined();
  });
});

describe('decide — a report arrived', () => {
  it('passes when nothing reaches the threshold', () => {
    const decision = decide(run({ stdout: report({ info: 0, low: 0, high: 0 }) }), 'high');
    expect(decision.exitCode).toBe(0);
    expect(decision.out).toEqual(['audit: no high/critical advisories']);
    expect(decision.annotation).toBeUndefined();
  });

  it('counts what sits below the threshold without failing on it', () => {
    const decision = decide(run({ stdout: report({ low: 1, moderate: 2, high: 0 }) }), 'high');
    expect(decision.exitCode).toBe(0);
    expect(decision.out[0]).toBe('audit: no high/critical advisories (3 below the high threshold)');
  });

  it('fails on advisories at or above the level, and lists them', () => {
    const decision = decide(
      run({
        code: 1,
        stdout: report(
          { low: 1, high: 1, critical: 1 },
          {
            1: {
              module_name: 'tar',
              severity: 'high',
              title: 'Arbitrary file write',
              url: 'https://example.test/1',
            },
            2: { module_name: 'ws', severity: 'critical', title: 'DoS' },
            3: { module_name: 'lodash', severity: 'low', title: 'Prototype pollution' },
          },
        ),
      }),
      'high',
    );

    expect(decision.exitCode).toBe(1);
    expect(decision.err).toEqual([
      'audit: 2 advisory/advisories at high or above',
      '  - [high] tar: Arbitrary file write',
      '    https://example.test/1',
      '  - [critical] ws: DoS',
    ]);
    expect(decision.annotation).toEqual({
      kind: 'error',
      message: '2 advisory/advisories at high or above',
    });
  });

  it('still fails when the counts say so but the advisories are missing', () => {
    // The counts are the gate; the list is only how the failure is explained.
    const decision = decide(
      run({ code: 1, stdout: JSON.stringify({ metadata: { vulnerabilities: { high: 2 } } }) }),
      'high',
    );
    expect(decision.exitCode).toBe(1);
    expect(decision.err).toEqual(['audit: 2 advisory/advisories at high or above']);
  });

  it('gates on the level it was given, not always on high', () => {
    const vulns = { low: 1, moderate: 1, high: 0, critical: 0 };
    expect(decide(run({ stdout: report(vulns) }), 'moderate').exitCode).toBe(1);
    expect(decide(run({ stdout: report(vulns) }), 'high').exitCode).toBe(0);
  });

  it('trusts the report over a non-zero exit code', () => {
    // pnpm exits 1 on any advisory at all; only the gated ones should fail us.
    const decision = decide(run({ code: 1, stdout: report({ low: 4, high: 0 }) }), 'high');
    expect(decision.exitCode).toBe(0);
  });
});

describe('decide — no report', () => {
  it('treats a timeout as inconclusive and says so loudly', () => {
    const decision = decide(run({ code: null, timedOut: true }), 'high');
    expect(decision.exitCode).toBe(0);
    expect(decision.annotation?.kind).toBe('warning');
    expect(decision.annotation?.message).toContain('dependencies were NOT audited');
    expect(decision.annotation?.message).toContain('Gave up after 60s');
    expect(decision.annotation?.message).toContain('Last output: no output');
    expect(decision.err[0]).toContain('audit: skipped (registry unreachable)');
  });

  it('reports the deadline it was actually given', () => {
    const decision = decide(run({ timedOut: true }), 'high', 15_000);
    expect(decision.annotation?.message).toContain('Gave up after 15s');
  });

  it.each([
    'ERR_PNPM_AUDIT_BAD_RESPONSE  The audit endpoint returned a non-JSON response',
    'ERR_PNPM_AUDIT_ENDPOINT_NOT_EXISTS',
    'TimeoutError: The operation was aborted due to timeout',
    'request to https://registry.npmjs.org/-/npm/v1/security/advisories/bulk failed',
    'FetchError: getaddrinfo EAI_AGAIN registry.npmjs.org',
    'Error: connect ECONNREFUSED 127.0.0.1:443',
    'socket hang up',
    'read ECONNRESET',
    '[WARN] POST .../bulk error (23). Will retry in 10 seconds.',
    'The audit endpoint responded with status code 503',
    'unexpected HTTP 429 from the advisory endpoint',
  ])('treats %s as the registry, not as us', (stderr) => {
    const decision = decide(run({ code: 1, stderr }), 'high');
    expect(decision.exitCode).toBe(0);
    expect(decision.annotation?.kind).toBe('warning');
    expect(decision.annotation?.message).not.toContain('Gave up after');
  });

  it('forgives what pnpm actually prints when the endpoint is unreachable', () => {
    // Captured verbatim from `pnpm audit --json --registry=http://127.0.0.1:1/`:
    // the report slot holds an error object, and stderr is empty. Nothing else
    // in this suite covers it, and before `fetch failed` was recognised this
    // exact output failed the job the wrapper exists to keep green.
    const decision = decide(
      run({
        code: 1,
        stdout: '{\n  "error": {\n    "code": "pnpm",\n    "message": "fetch failed"\n  }\n}\n',
      }),
      'high',
    );
    expect(decision.exitCode).toBe(0);
    expect(decision.annotation?.kind).toBe('warning');
    expect(decision.annotation?.message).toContain('fetch failed (pnpm)');
  });

  it.each(['ERR_PNPM_FETCH_503', 'ERR_PNPM_FETCH_429'])('forgives %s', (stderr) => {
    expect(decide(run({ code: 1, stderr }), 'high').exitCode).toBe(0);
  });

  it('does not forgive ERR_PNPM_FETCH_404, which is likely a misconfiguration', () => {
    expect(decide(run({ code: 1, stderr: 'ERR_PNPM_FETCH_404' }), 'high').exitCode).toBe(1);
  });

  it('recognises registry trouble printed to stdout', () => {
    const decision = decide(run({ code: 1, stdout: 'ETIMEDOUT' }), 'high');
    expect(decision.exitCode).toBe(0);
    expect(decision.annotation?.kind).toBe('warning');
    expect(decision.annotation?.message).toContain('Last output: ETIMEDOUT');
  });

  it('fails on a failure that names nothing network-like', () => {
    const decision = decide(
      run({ code: 1, stderr: "[ERROR] Unknown option: 'not-a-flag'" }),
      'high',
    );
    expect(decision.exitCode).toBe(1);
    expect(decision.err[0]).toContain('failed with exit code 1 and no advisory report');
    expect(decision.err[0]).toContain("Unknown option: 'not-a-flag'");
    expect(decision.annotation).toEqual({
      kind: 'error',
      message: 'pnpm audit failed with exit code 1 and produced no advisory report',
    });
  });

  it.each([
    'ERR_PNPM_OUTDATED_LOCKFILE  Cannot install with "frozen-lockfile"',
    'resolved 503 packages in 12s, then failed to link',
    'overlock@1.500.2 could not be resolved',
  ])('does not read a bare number in %s as a 5xx', (stderr) => {
    // The status match is anchored to a status word precisely so a dependency
    // count or a version never buys a silent pass.
    expect(decide(run({ code: 1, stderr }), 'high').exitCode).toBe(1);
  });

  it('uses the error object --json leaves where the report would have been', () => {
    const decision = decide(
      run({
        code: 1,
        stdout: JSON.stringify({ error: { code: 'ERR_PNPM_AUDIT_BAD_RESPONSE', message: 'bad' } }),
      }),
      'high',
    );
    expect(decision.exitCode).toBe(0);
    expect(decision.annotation?.message).toContain('bad (ERR_PNPM_AUDIT_BAD_RESPONSE)');
  });

  it('fills in what the error object leaves out', () => {
    const decision = decide(run({ code: 1, stdout: JSON.stringify({ error: {} }) }), 'high');
    expect(decision.exitCode).toBe(1);
    expect(decision.err[0]).toContain('unknown error (no code)');
  });

  it('fails when a report parses but carries no vulnerability counts', () => {
    // A body that is JSON but not an audit report is not a verdict.
    expect(decide(run({ code: 1, stdout: '{"error":"nope"}' }), 'high').exitCode).toBe(1);
  });

  it('quotes only the last six lines of the failure', () => {
    const stderr = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`).join('\n');
    const detail = decide(run({ code: 1, stderr }), 'high').err[0] ?? '';
    expect(detail).toContain('line 15');
    expect(detail).not.toContain('line 14');
  });

  it('falls back to stdout, then to a placeholder, for the detail', () => {
    expect(decide(run({ code: 1, stdout: 'only stdout' }), 'high').err[0]).toContain('only stdout');
    expect(decide(run({ code: 1 }), 'high').err[0]).toContain('no output');
  });
});

/** A child process that does nothing until a test tells it to. */
const fakeChild = () => {
  const child = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
    kill: ReturnType<typeof vi.fn>;
  };
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = vi.fn();
  return child;
};

describe('runAudit', () => {
  it('asks pnpm for JSON at the requested level, with the fetch budget cut', async () => {
    const child = fakeChild();
    const spawner = vi.fn(() => child as unknown as ChildProcess);

    const result = runAudit('moderate', { spawner: spawner as unknown as Spawner });
    child.stdout.emit('data', '{"metadata":');
    child.stdout.emit('data', '{}}');
    child.stderr.emit('data', 'a warning');
    child.emit('close', 0);

    expect(await result).toEqual({
      stdout: '{"metadata":{}}',
      stderr: 'a warning',
      code: 0,
      timedOut: false,
    });
    // The limits are flags, not `npm_config_*`: pnpm was measured ignoring the
    // environment variables and honouring the flags.
    expect(spawner).toHaveBeenCalledWith(
      'pnpm',
      [
        'audit',
        '--json',
        '--audit-level=moderate',
        '--fetch-timeout=15000',
        '--fetch-retries=1',
        '--fetch-retry-mintimeout=5000',
        '--fetch-retry-maxtimeout=10000',
      ],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );
  });

  it('reports a spawn failure as no exit code, with the reason attached', async () => {
    const child = fakeChild();
    const result = runAudit('high', {
      spawner: (() => child as unknown as ChildProcess) as unknown as Spawner,
    });
    child.stderr.emit('data', 'partial output\n');
    child.emit('error', new Error('spawn pnpm ENOENT'));

    expect(await result).toEqual({
      stdout: '',
      stderr: 'partial output\nspawn pnpm ENOENT',
      code: null,
      timedOut: false,
    });
  });

  describe('the deadline', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('kills a child that overruns it, then kills it harder', async () => {
      const child = fakeChild();
      const result = runAudit('high', {
        spawner: (() => child as unknown as ChildProcess) as unknown as Spawner,
        deadlineMs: 1_000,
        killGraceMs: 500,
      });

      vi.advanceTimersByTime(1_000);
      expect(child.kill).toHaveBeenCalledWith('SIGTERM');
      vi.advanceTimersByTime(500);
      expect(child.kill).toHaveBeenCalledWith('SIGKILL');

      child.emit('close', null);
      expect(await result).toMatchObject({ code: null, timedOut: true });
    });

    it('does not kill a child that finishes in time', async () => {
      const child = fakeChild();
      const result = runAudit('high', {
        spawner: (() => child as unknown as ChildProcess) as unknown as Spawner,
        deadlineMs: 1_000,
      });

      child.emit('close', 0);
      await result;
      vi.advanceTimersByTime(10_000);
      expect(child.kill).not.toHaveBeenCalled();
    });
  });
});

describe('annotate', () => {
  const log = vi.spyOn(console, 'log').mockImplementation(() => {});
  afterEach(() => log.mockClear());

  it('writes a workflow command on one line', () => {
    annotate('warning', 'first line\n  second line');
    expect(log).toHaveBeenCalledWith('::warning title=pnpm audit::first line second line');
  });

  it('appends to the step summary when the runner offers one', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'audit-')), 'summary.md');
    writeFileSync(file, '');
    vi.stubEnv('GITHUB_STEP_SUMMARY', file);

    annotate('error', 'something to say');
    expect(readFileSync(file, 'utf8')).toBe('**pnpm audit** — something to say\n\n');
    vi.unstubAllEnvs();
  });

  it('says nothing to a file when there is no summary to write to', () => {
    vi.stubEnv('GITHUB_STEP_SUMMARY', '');
    expect(() => annotate('warning', 'no summary here')).not.toThrow();
    vi.unstubAllEnvs();
  });
});

describe('main', () => {
  const log = vi.spyOn(console, 'log').mockImplementation(() => {});
  const error = vi.spyOn(console, 'error').mockImplementation(() => {});
  afterEach(() => {
    log.mockClear();
    error.mockClear();
  });

  it('exits 0 and prints the verdict when the tree is clean', async () => {
    const code = await main(['--audit-level=high'], {
      run: async () => run({ stdout: report({ high: 0 }) }),
    });
    expect(code).toBe(0);
    expect(log).toHaveBeenCalledWith('audit: no high/critical advisories');
  });

  it('exits 1 and annotates when the tree is vulnerable', async () => {
    const code = await main([], {
      run: async () =>
        run({
          code: 1,
          stdout: report({ high: 1 }, { 1: { module_name: 'tar', severity: 'high' } }),
        }),
    });
    expect(code).toBe(1);
    expect(error).toHaveBeenCalledWith('audit: 1 advisory/advisories at high or above');
    expect(log).toHaveBeenCalledWith(
      '::error title=pnpm audit::1 advisory/advisories at high or above',
    );
  });

  it('exits 0 and warns when the registry could not answer', async () => {
    const code = await main([], { run: async () => run({ code: null, timedOut: true }) });
    expect(code).toBe(0);
    expect(log.mock.calls[0]?.[0]).toContain('::warning title=pnpm audit::');
  });

  it('passes the requested level through to the run', async () => {
    const seen: string[] = [];
    await main(['--audit-level=low'], {
      run: async (level) => {
        seen.push(level);
        return run({ stdout: report({ low: 0 }) });
      },
    });
    expect(seen).toEqual(['low']);
  });

  it('exits 2 on a severity it does not know', async () => {
    const code = await main(['--audit-level=spicy'], {
      run: async () => {
        throw new Error('should not run');
      },
    });
    expect(code).toBe(2);
    expect(error).toHaveBeenCalledWith('audit: unknown --audit-level=spicy');
  });
});

describe('the entry point', () => {
  it('sets the process exit code from main', () => {
    // The one thing the unit tests cannot reach: that running this file as a
    // script actually exits with what `main` returned. `--audit-level=spicy`
    // fails before anything touches the network.
    const script = new URL('./audit.ts', import.meta.url).pathname;
    let status = 0;
    try {
      execFileSync(process.execPath, ['--import', 'tsx', script, '--audit-level=spicy'], {
        encoding: 'utf8',
        stdio: 'pipe',
      });
    } catch (failure) {
      status = (failure as { status: number }).status;
    }
    expect(status).toBe(2);
  });
});
