import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { appendLedger } from './ledger.js';
import type { Finding, Grade, Report, RuleId, Severity } from './types.js';

export interface EvaluationConfig {
  repository: string;
  captureDiff?: boolean;
}
export interface EvaluationFinding {
  key: string;
  finding: Finding;
  disposition: 'standing' | 'suppressed' | 'off';
}
export interface EvaluationRun {
  schema: 2;
  run_id: string;
  session: string;
  timestamp: string;
  repository: string;
  version: string;
  build: string;
  source: string;
  environment: string;
  branch: string | null;
  base: string | null;
  head: string | null;
  patch: string | null;
  settings: {
    base: string;
    baseMode: string;
    staged: boolean;
    failOn: Severity | 'none';
    failOnEmpty: boolean;
    severity: Partial<Record<RuleId, Grade>>;
    testGlob: string[];
    untracked: boolean;
    /**
     * Paths left out of the patch besides `.overlock`. Optional because records
     * written before it existed carry none, and those excluded nothing.
     */
    exclude?: string[];
  };
  scope: { files: number; commits: number } | null;
  duration_ms: number;
  status: 'analyzed' | 'empty' | 'error';
  decision: 'pass' | 'fail' | 'block' | 'suppression_block' | 'retry_bypass' | 'error';
  exit_code: number;
  error: string | null;
  findings: EvaluationFinding[];
}

export const VERSION = typeof __OVERLOCK_VERSION__ === 'string' ? __OVERLOCK_VERSION__ : 'source';
export const BUILD = typeof __OVERLOCK_BUILD__ === 'string' ? __OVERLOCK_BUILD__ : 'source';
export const fingerprint = (text: string): string =>
  createHash('sha256').update(text).digest('hex');

/** Evidence is opt-in here; the legacy home ledger still never stores source. */
export function evaluationFindings(
  repository: string,
  patch: string,
  produced: Finding[],
  report: Report,
  severity: Partial<Record<RuleId, Grade>>,
): EvaluationFinding[] {
  const standing = new Map(report.findings.map((f) => [f.id, f]));
  return produced.map((original) => {
    const grade = severity[original.rule];
    const finding = standing.get(original.id) ?? {
      ...original,
      severity: grade === 'off' || grade === undefined ? original.severity : grade,
    };
    return {
      // No line number: identical reruns and line shifts within the same patch
      // should not inflate the count. Changed patches still require review linking.
      key: fingerprint(
        JSON.stringify([
          repository,
          patch,
          finding.rule,
          finding.file,
          finding.subject,
          finding.evidence,
        ]),
      ),
      finding,
      disposition: grade === 'off' ? 'off' : standing.has(original.id) ? 'standing' : 'suppressed',
    };
  });
}

export function evaluationIdentity(
  env: NodeJS.ProcessEnv,
  session?: string,
): {
  run_id: string;
  session: string;
  environment: string;
} {
  return {
    run_id: randomUUID(),
    // Hash external session names so paths and credentials cannot leak into records
    // or turn a session name into a path. With no session, each invocation is a shard.
    session: fingerprint(env.OVERLOCK_SESSION_ID || session || randomUUID()).slice(0, 24),
    environment:
      env.OVERLOCK_ENVIRONMENT ||
      (env.CI ? 'ci' : env.container || existsSync('/.dockerenv') ? 'container' : 'local'),
  };
}

export function persistEvaluation(
  root: string,
  record: EvaluationRun,
  warn: (message: string) => void,
): void {
  const path = join(root, '.overlock', 'runs', `${record.session}.jsonl`);
  if (!appendLedger(record, path))
    warn(
      'overlock: evaluation record could not be saved; export or mount .overlock before ending this session.\n',
    );
}

/** Store each exact pre-review patch once, including work never committed. */
export function captureEvaluationDiff(
  root: string,
  diff: string,
  warn: (message: string) => void,
): void {
  try {
    const directory = join(root, '.overlock', 'patches');
    mkdirSync(directory, { recursive: true });
    const path = join(directory, `${fingerprint(diff)}.diff`);
    // Concurrent writers have identical content under this content-addressed path.
    writeFileSync(path, diff);
  } catch {
    warn('overlock: evaluation diff could not be saved.\n');
  }
}
