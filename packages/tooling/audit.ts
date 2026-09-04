/**
 * Runs `pnpm audit` in a way that fails on vulnerabilities and only on
 * vulnerabilities.
 *
 * `pnpm audit` asks the npm registry's bulk advisory endpoint for a verdict, so
 * it has two entirely different ways to exit non-zero: the dependency tree is
 * vulnerable, or npm is having a bad day. The second one is not a fact about
 * this repository, and it is expensive — the default retry schedule is a 60s
 * fetch timeout, then 10s, then 60s, then another 60s timeout, so a registry
 * outage bought 4m12s of waiting and a red check on a branch nothing was wrong
 * with (run 33857367187).
 *
 * So the two are told apart. The advisory report decides the verdict when one
 * arrives; when none does, the run is reported as inconclusive with a warning
 * and the job continues. The waiting is capped twice over: the retry budget is
 * cut to one, and the whole child is killed at DEADLINE_MS regardless of what
 * it thinks it is doing.
 *
 * Inconclusive is not a blanket pass. A failure that names nothing network-like
 * — a broken lockfile, an unreadable manifest, an option pnpm stopped
 * accepting — still fails, because that is a fact about this repository and
 * swallowing it would leave the audit permanently, silently green.
 *
 * The work is split into `runAudit` (spawn the child, bound the waiting) and
 * `decide` (turn what came back into an exit code), because the interesting
 * half is the second one and it should be testable without a registry.
 */
import { spawn as nodeSpawn, type ChildProcess } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { isEntry } from './entry.js';

/** Severities in the order `--audit-level` ranks them. */
export const SEVERITIES = ['info', 'low', 'moderate', 'high', 'critical'] as const;
export type Severity = (typeof SEVERITIES)[number];

/**
 * The ceiling on the whole attempt. The retry budget below should bring the
 * child in well under this; the deadline exists for the failure modes a retry
 * budget does not cover, such as a connection that is accepted and then never
 * answers.
 */
export const DEADLINE_MS = 60_000;

/** How long a child gets to honour SIGTERM before it is killed outright. */
export const KILL_GRACE_MS = 5_000;

/**
 * The retry budget, cut from pnpm's default of a 60s timeout and two retries to
 * one retry and 15s. These have to be passed as flags: pnpm ignores the
 * `npm_config_fetch_timeout` environment variable here (measured — the request
 * still ran to the 60s default), and honours `--fetch-timeout` (measured — it
 * gave up in 8.6s when asked to). Worst case is now ~35s.
 *
 * If a future pnpm drops one of these, it exits on the unknown option and this
 * script reports that as a failure rather than a warning, which is the right
 * way round: a silently un-capped audit is the thing being fixed.
 */
export const FETCH_LIMITS = [
  '--fetch-timeout=15000',
  '--fetch-retries=1',
  '--fetch-retry-mintimeout=5000',
  '--fetch-retry-maxtimeout=10000',
];

export type Advisory = {
  module_name?: string;
  severity?: string;
  title?: string;
  url?: string;
};

export type Report = {
  advisories?: Record<string, Advisory>;
  metadata?: { vulnerabilities?: Partial<Record<Severity, number>> };
  /** What `--json` emits instead of a report when the request failed. */
  error?: { code?: number | string; message?: string };
};

export type AuditRun = {
  stdout: string;
  stderr: string;
  code: number | null;
  timedOut: boolean;
};

/** The shape of `child_process.spawn` this module actually depends on. */
export type Spawner = (
  command: string,
  args: string[],
  options: { stdio: ['ignore', 'pipe', 'pipe'] },
) => ChildProcess;

/** `--audit-level=<severity>`, or `undefined` when the argument is not one. */
export const parseLevel = (argv: string[]): Severity | undefined => {
  const arg = argv.find((a) => a.startsWith('--audit-level='));
  const value = arg?.slice('--audit-level='.length) ?? 'high';
  return (SEVERITIES as readonly string[]).includes(value) ? (value as Severity) : undefined;
};

export const runAudit = (
  level: Severity,
  {
    spawner = nodeSpawn as Spawner,
    deadlineMs = DEADLINE_MS,
    killGraceMs = KILL_GRACE_MS,
  }: { spawner?: Spawner; deadlineMs?: number; killGraceMs?: number } = {},
): Promise<AuditRun> =>
  new Promise((resolve) => {
    // `--json` so the verdict is read from the report rather than inferred from
    // an exit code that conflates "vulnerable" with "could not ask".
    const child = spawner('pnpm', ['audit', '--json', `--audit-level=${level}`, ...FETCH_LIMITS], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let timedOut = false;
    child.stdout?.on('data', (chunk) => (stdout += chunk));
    child.stderr?.on('data', (chunk) => (stderr += chunk));

    const deadline = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      // A child ignoring SIGTERM must not become the thing that hangs the job.
      setTimeout(() => child.kill('SIGKILL'), killGraceMs).unref();
    }, deadlineMs);

    child.on('error', (error: Error) => {
      clearTimeout(deadline);
      resolve({ stdout, stderr: `${stderr}${error.message}`, code: null, timedOut });
    });
    child.on('close', (code: number | null) => {
      clearTimeout(deadline);
      resolve({ stdout, stderr, code, timedOut });
    });
  });

/**
 * pnpm writes progress and warnings to stderr and the report to stdout, but a
 * banner on stdout would be enough to break a plain `JSON.parse`, so the object
 * is located rather than assumed to be the whole stream.
 */
export const parseReport = (stdout: string): Report | undefined => {
  const start = stdout.indexOf('{');
  const end = stdout.lastIndexOf('}');
  if (start === -1 || end <= start) return undefined;
  try {
    return JSON.parse(stdout.slice(start, end + 1)) as Report;
  } catch {
    return undefined;
  }
};

/**
 * Whether a failure without a report is the registry's fault. Matched against
 * pnpm's own wording for the endpoint being unreachable, plus the usual socket
 * and HTTP-level symptoms. Anything else is treated as this repository's
 * problem and fails.
 */
export const REGISTRY_TROUBLE = new RegExp(
  [
    // pnpm's own names for the advisory endpoint failing.
    'ERR_PNPM_AUDIT_(?:BAD_RESPONSE|ENDPOINT_NOT_EXISTS)',
    'Will retry in',
    // pnpm's HTTP-status error codes, limited to the retryable ones: a 404 on
    // the registry is more likely a misconfiguration than an outage.
    'ERR_PNPM_FETCH_(?:408|429|5\\d{2})',
    // What pnpm actually reports when the endpoint is unreachable, measured:
    // `{"error":{"code":"pnpm","message":"fetch failed"}}` on stdout and
    // nothing on stderr. This is undici's generic network failure, and without
    // it the single most common outage is read as this repository's fault --
    // which is the whole thing this wrapper exists to prevent.
    'fetch failed',
    // Socket and DNS level.
    'TimeoutError|aborted due to timeout|socket hang up',
    'ETIMEDOUT|ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|EHOSTUNREACH|ENETUNREACH',
    // HTTP level. Anchored to a status word rather than matching any three
    // digits, so a dependency count or a version never reads as a 5xx.
    '(?:status(?: ?code)?|HTTP)\\D{0,3}(?:408|429|5\\d{2})\\b',
    // A failed request always names the URL it was for.
    'https?://\\S*registry\\S*',
  ].join('|'),
  'i',
);

export type Decision = {
  exitCode: 0 | 1;
  /** Lines for stdout, then lines for stderr; the caller does the printing. */
  out: string[];
  err: string[];
  annotation?: { kind: 'warning' | 'error'; message: string };
};

/** Turns what the child produced into a verdict, with nothing left implicit. */
export const decide = (run: AuditRun, level: Severity, deadlineMs = DEADLINE_MS): Decision => {
  const report = parseReport(run.stdout);

  if (report?.metadata?.vulnerabilities) {
    const counts = report.metadata.vulnerabilities;
    const gate = SEVERITIES.slice(SEVERITIES.indexOf(level));
    const failing = gate.reduce((total, severity) => total + (counts[severity] ?? 0), 0);

    if (failing === 0) {
      const total = SEVERITIES.reduce((sum, severity) => sum + (counts[severity] ?? 0), 0);
      return {
        exitCode: 0,
        out: [
          `audit: no ${gate.join('/')} advisories` +
            (total > 0 ? ` (${total} below the ${level} threshold)` : ''),
        ],
        err: [],
      };
    }

    // Printed here rather than left to `--json`, because the report the reader
    // would otherwise get is one line of minified JSON.
    const err = [`audit: ${failing} advisory/advisories at ${level} or above`];
    for (const advisory of Object.values(report.advisories ?? {})) {
      if (!gate.includes(advisory.severity as Severity)) continue;
      err.push(`  - [${advisory.severity}] ${advisory.module_name}: ${advisory.title}`);
      if (advisory.url) err.push(`    ${advisory.url}`);
    }
    return {
      exitCode: 1,
      out: [],
      err,
      annotation: {
        kind: 'error',
        message: `${failing} advisory/advisories at ${level} or above`,
      },
    };
  }

  // No report. Either the registry could not answer — in which case `--json`
  // leaves an `{ error: { code, message } }` object where the report would have
  // been — or pnpm failed for a reason that has nothing to do with the registry.
  const reported = typeof report?.error === 'object' ? report.error : undefined;
  const detail = reported
    ? `${reported.message ?? 'unknown error'} (${reported.code ?? 'no code'})`
    : (run.stderr.trim() || run.stdout.trim() || 'no output').split('\n').slice(-6).join('\n');

  if (
    run.timedOut ||
    REGISTRY_TROUBLE.test(detail) ||
    REGISTRY_TROUBLE.test(run.stderr) ||
    REGISTRY_TROUBLE.test(run.stdout)
  ) {
    return {
      exitCode: 0,
      out: [],
      err: [`audit: skipped (registry unreachable)\n${detail}`],
      annotation: {
        kind: 'warning',
        message:
          `advisory database unreachable — dependencies were NOT audited on this run. ` +
          (run.timedOut ? `Gave up after ${deadlineMs / 1000}s. ` : '') +
          `Last output: ${detail}`,
      },
    };
  }

  return {
    exitCode: 1,
    out: [],
    err: [`audit: pnpm audit failed with exit code ${run.code} and no advisory report\n${detail}`],
    annotation: {
      kind: 'error',
      message: `pnpm audit failed with exit code ${run.code} and produced no advisory report`,
    },
  };
};

export const annotate = (kind: 'warning' | 'error', message: string): void => {
  // Collapsed onto one line: a multi-line annotation is truncated to its first.
  console.log(`::${kind} title=pnpm audit::${message.replace(/\s*\n\s*/g, ' ')}`);
  const summary = process.env.GITHUB_STEP_SUMMARY;
  if (summary) appendFileSync(summary, `**pnpm audit** — ${message}\n\n`);
};

/** Returns the process exit code rather than taking it, so tests can call it. */
export const main = async (
  argv: string[],
  { run = runAudit }: { run?: typeof runAudit } = {},
): Promise<number> => {
  const level = parseLevel(argv);
  if (!level) {
    const arg = argv.find((a) => a.startsWith('--audit-level='));
    console.error(`audit: unknown ${arg}`);
    return 2;
  }

  const decision = decide(await run(level), level);
  for (const line of decision.out) console.log(line);
  for (const line of decision.err) console.error(line);
  if (decision.annotation) annotate(decision.annotation.kind, decision.annotation.message);
  return decision.exitCode;
};

/* v8 ignore start -- the entry shell: it can only run in a child process, and
   nothing a child does is reported back into this run's coverage. It is covered
   by the test that spawns this file, which asserts the exit code it sets. */
if (isEntry(import.meta.url)) {
  process.exit(await main(process.argv.slice(2)));
}
/* v8 ignore stop */
