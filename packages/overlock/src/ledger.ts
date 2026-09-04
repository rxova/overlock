import { appendFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import type { Report, Severity } from './types.js';

export interface LedgerEntry {
  ts: string;
  repo: string;
  branch: string;
  base: string;
  mode: 'check' | 'hook';
  ok: boolean;
  /** True when this run actually stopped the agent, not merely reported. */
  blocked: boolean;
  counts: Record<Severity, number>;
  suppressed: number;
  rules: { rule: string; severity: Severity; file: string; line: number | null }[];
}

export function ledgerPath(env: NodeJS.ProcessEnv = process.env): string {
  const override = env.OVERLOCK_LEDGER;
  if (override) return override;
  return join(env.OVERLOCK_HOME ?? join(homedir(), '.overlock'), 'ledger.jsonl');
}

export function toEntry(input: {
  report: Report;
  repo: string;
  branch: string;
  mode: 'check' | 'hook';
  blocked: boolean;
  now?: Date;
}): LedgerEntry {
  const { report, repo, branch, mode, blocked, now = new Date() } = input;
  return {
    ts: now.toISOString(),
    repo,
    branch,
    base: report.base,
    mode,
    ok: report.ok,
    blocked,
    counts: report.counts,
    suppressed: report.suppressed,
    rules: report.findings.map((f) => ({
      rule: f.rule,
      severity: f.severity,
      file: f.file,
      line: f.line,
    })),
  };
}

/**
 * Append-only, one JSON object per line, and deliberately best-effort: a
 * read-only home directory or a full disk must never be the reason a gate stops
 * gating. The ledger is evidence, not control flow.
 *
 * It records rule, severity and location — never file contents. The evidence
 * lines in a finding are source code, and a ledger that accumulated them would
 * be a copy of the repository sitting in a home directory.
 */
export function appendLedger(entry: LedgerEntry, path = ledgerPath()): boolean {
  try {
    mkdirSync(dirname(path), { recursive: true });
    appendFileSync(path, `${JSON.stringify(entry)}\n`, 'utf8');
    return true;
  } catch {
    return false;
  }
}
