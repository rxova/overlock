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
 */
import { spawn } from 'node:child_process';
import { appendFileSync } from 'node:fs';

/** Severities in the order `--audit-level` ranks them. */
const SEVERITIES = ['info', 'low', 'moderate', 'high', 'critical'] as const;
type Severity = (typeof SEVERITIES)[number];

const level = ((): Severity => {
  const arg = process.argv.slice(2).find((a) => a.startsWith('--audit-level='));
  const value = arg?.slice('--audit-level='.length) ?? 'high';
  if (!(SEVERITIES as readonly string[]).includes(value)) {
    console.error(`audit: unknown --audit-level=${value}`);
    process.exit(2);
  }
  return value as Severity;
})();

/**
 * The ceiling on the whole attempt. The retry budget below should bring the
 * child in well under this; the deadline exists for the failure modes a retry
 * budget does not cover, such as a connection that is accepted and then never
 * answers.
 */
const DEADLINE_MS = 60_000;

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
const FETCH_LIMITS = [
  '--fetch-timeout=15000',
  '--fetch-retries=1',
  '--fetch-retry-mintimeout=5000',
  '--fetch-retry-maxtimeout=10000',
];

type Advisory = {
  module_name?: string;
  severity?: string;
  title?: string;
  url?: string;
};
type Report = {
  advisories?: Record<string, Advisory>;
  metadata?: { vulnerabilities?: Partial<Record<Severity, number>> };
  /** What `--json` emits instead of a report when the request failed. */
  error?: { code?: number | string; message?: string };
};

const run = (): Promise<{
  stdout: string;
  stderr: string;
  code: number | null;
  timedOut: boolean;
}> =>
  new Promise((resolve) => {
    // `--json` so the verdict is read from the report rather than inferred from
    // an exit code that conflates "vulnerable" with "could not ask".
    const child = spawn('pnpm', ['audit', '--json', `--audit-level=${level}`, ...FETCH_LIMITS], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let timedOut = false;
    child.stdout.on('data', (chunk) => (stdout += chunk));
    child.stderr.on('data', (chunk) => (stderr += chunk));

    const deadline = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      // A child ignoring SIGTERM must not become the thing that hangs the job.
      setTimeout(() => child.kill('SIGKILL'), 5_000).unref();
    }, DEADLINE_MS);

    child.on('error', (error) => {
      clearTimeout(deadline);
      resolve({ stdout, stderr: `${stderr}${error.message}`, code: null, timedOut });
    });
    child.on('close', (code) => {
      clearTimeout(deadline);
      resolve({ stdout, stderr, code, timedOut });
    });
  });

/**
 * pnpm writes progress and warnings to stderr and the report to stdout, but a
 * banner on stdout would be enough to break a plain `JSON.parse`, so the object
 * is located rather than assumed to be the whole stream.
 */
const parseReport = (stdout: string): Report | undefined => {
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
const REGISTRY_TROUBLE = new RegExp(
  [
    // pnpm's own names for the advisory endpoint failing.
    'ERR_PNPM_AUDIT_(?:BAD_RESPONSE|ENDPOINT_NOT_EXISTS)',
    'Will retry in',
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

const annotate = (kind: 'warning' | 'error', message: string): void => {
  // Collapsed onto one line: a multi-line annotation is truncated to its first.
  console.log(`::${kind} title=pnpm audit::${message.replace(/\s*\n\s*/g, ' ')}`);
  const summary = process.env.GITHUB_STEP_SUMMARY;
  if (summary) appendFileSync(summary, `**pnpm audit** — ${message}\n\n`);
};

const { stdout, stderr, code, timedOut } = await run();
const report = parseReport(stdout);

if (report?.metadata?.vulnerabilities) {
  const counts = report.metadata.vulnerabilities;
  const gate = SEVERITIES.slice(SEVERITIES.indexOf(level));
  const failing = gate.reduce((total, severity) => total + (counts[severity] ?? 0), 0);

  if (failing === 0) {
    const total = SEVERITIES.reduce((sum, severity) => sum + (counts[severity] ?? 0), 0);
    console.log(
      `audit: no ${gate.join('/')} advisories` +
        (total > 0 ? ` (${total} below the ${level} threshold)` : ''),
    );
    process.exit(0);
  }

  // Printed here rather than left to `--json`, because the report the reader
  // would otherwise get is one line of minified JSON.
  console.error(`audit: ${failing} advisory/advisories at ${level} or above`);
  for (const advisory of Object.values(report.advisories ?? {})) {
    if (!gate.includes(advisory.severity as Severity)) continue;
    console.error(`  - [${advisory.severity}] ${advisory.module_name}: ${advisory.title}`);
    if (advisory.url) console.error(`    ${advisory.url}`);
  }
  annotate('error', `${failing} advisory/advisories at ${level} or above`);
  process.exit(1);
}

// No report. Either the registry could not answer — in which case `--json`
// leaves an `{ error: { code, message } }` object where the report would have
// been — or pnpm failed for a reason that has nothing to do with the registry.
const reported = report?.error;
const detail = reported
  ? `${reported.message ?? 'unknown error'} (${reported.code ?? 'no code'})`
  : (stderr.trim() || stdout.trim() || 'no output').split('\n').slice(-6).join('\n');

if (timedOut || REGISTRY_TROUBLE.test(detail) || REGISTRY_TROUBLE.test(stderr)) {
  annotate(
    'warning',
    `advisory database unreachable — dependencies were NOT audited on this run. ` +
      (timedOut ? `Gave up after ${DEADLINE_MS / 1000}s. ` : '') +
      `Last output: ${detail}`,
  );
  console.error(`audit: skipped (registry unreachable)\n${detail}`);
  process.exit(0);
}

console.error(`audit: pnpm audit failed with exit code ${code} and no advisory report\n${detail}`);
annotate('error', `pnpm audit failed with exit code ${code} and produced no advisory report`);
process.exit(1);
