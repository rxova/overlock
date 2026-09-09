import { readFileSync } from 'node:fs';
import type { LedgerEntry } from './ledger.js';
import type { RuleId, Severity } from './types.js';

/**
 * Reading back what the ledger has been collecting.
 *
 * The ledger exists to answer one question over a period of use: how often did
 * an agent weaken a test in a change that would otherwise have been merged
 * without notice? Until something read it back, the file only accumulated.
 */

export interface Window {
  /** Only count runs within this many days. Undefined means everything. */
  days?: number | undefined;
  now?: Date;
}

/** Malformed lines are skipped rather than fatal: a partial ledger still answers. */
export function readLedger(path: string): LedgerEntry[] {
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch {
    return [];
  }

  const entries: LedgerEntry[] = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try {
      const parsed: unknown = JSON.parse(line);
      if (typeof parsed === 'object' && parsed !== null && 'ts' in parsed) {
        entries.push(parsed as LedgerEntry);
      }
    } catch {
      // A truncated final line is the normal shape of a file being appended to
      // while it is read. One unreadable row is not worth losing the rest.
    }
  }
  return entries;
}

export interface Summary {
  runs: number;
  /**
   * Runs carrying at least one high or medium finding.
   *
   * Low findings deliberately do not count. `TEST_AND_IMPL_TOGETHER` fires on
   * ordinary test-driven work and is the most common finding by a wide margin,
   * so counting it would let the tool clear its own bar on noise — which is the
   * one thing a self-reported metric must not do.
   */
  caught: number;
  /** Runs whose only findings were low severity. Context, not catches. */
  noted: number;
  /** Times the Stop hook actually stopped an agent. */
  blocked: number;
  suppressed: number;
  repos: number;
  /**
   * Runs in which each rule fired, not findings.
   *
   * One mass rename produces hundreds of findings in a single run, and counting
   * them individually lets one afternoon's refactor dominate a month of
   * history. Counting runs is also what `caught`, `noted` and `blocked` already
   * do, so the whole summary answers questions of the same shape.
   */
  byRule: { rule: RuleId; count: number }[];
  bySeverity: Record<Severity, number>;
  byRepo: { repo: string; caught: number }[];
  first: string | null;
  last: string | null;
  days: number | undefined;
}

export function summarize(entries: LedgerEntry[], window: Window = {}): Summary {
  const { days, now = new Date() } = window;

  const cutoff = days === undefined ? null : now.getTime() - days * 24 * 60 * 60 * 1000;
  const inWindow = entries.filter((e) => {
    if (cutoff === null) return true;
    const at = Date.parse(e.ts);
    return Number.isFinite(at) && at >= cutoff;
  });

  const byRule = new Map<RuleId, number>();
  const byRepo = new Map<string, number>();
  const bySeverity: Record<Severity, number> = { high: 0, medium: 0, low: 0 };

  let caught = 0;
  let noted = 0;
  let blocked = 0;
  let suppressed = 0;

  for (const entry of inWindow) {
    const rules = entry.rules ?? [];
    const real = rules.some((r) => r.severity === 'high' || r.severity === 'medium');

    if (real) {
      caught += 1;
      byRepo.set(entry.repo, (byRepo.get(entry.repo) ?? 0) + 1);
    } else if (rules.length > 0) {
      noted += 1;
    }
    if (entry.blocked) blocked += 1;
    suppressed += entry.suppressed ?? 0;

    for (const rule of new Set(rules.map((r) => r.rule as RuleId))) {
      byRule.set(rule, (byRule.get(rule) ?? 0) + 1);
    }
    for (const severity of new Set(rules.map((r) => r.severity))) {
      bySeverity[severity] += 1;
    }
  }

  const timestamps = inWindow.map((e) => e.ts).sort();

  return {
    runs: inWindow.length,
    caught,
    noted,
    blocked,
    suppressed,
    repos: new Set(inWindow.map((e) => e.repo)).size,
    byRule: [...byRule.entries()]
      .map(([rule, count]) => ({ rule, count }))
      .sort((a, b) => b.count - a.count || (a.rule < b.rule ? -1 : 1)),
    bySeverity,
    byRepo: [...byRepo.entries()]
      .map(([repo, count]) => ({ repo, caught: count }))
      .sort((a, b) => b.caught - a.caught || (a.repo < b.repo ? -1 : 1)),
    first: timestamps[0] ?? null,
    last: timestamps.at(-1) ?? null,
    days,
  };
}

/**
 * The bar, pre-registered before any of this was built so the result could not
 * be read the way it was wanted: four real catches in thirty days, and zero
 * false blocks annoying enough to make you switch it off.
 *
 * Only the first half is measurable from the ledger. The second half is a
 * judgement only the person who lived with it can make, so it is stated rather
 * than scored — a tool that graded itself on both halves would be marking its
 * own homework.
 */
export const CATCH_BAR = 4;
export const BAR_DAYS = 30;

export function meetsBar(summary: Summary): boolean {
  return summary.caught >= CATCH_BAR;
}
