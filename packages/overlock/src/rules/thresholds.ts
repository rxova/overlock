import { isTestFile, isThresholdConfig } from '../paths.js';
import type { DiffFile, Finding } from '../types.js';
import { finding, type Rule, type RuleContext } from './shared.js';

/** Keys whose number is a gate: lowering one buys a green build. */
const THRESHOLD_KEYS = [
  'statements',
  'branches',
  'functions',
  'lines',
  'fail_under',
  'fail-under',
  'minimum_coverage',
  'min_coverage',
  'coverage',
  'threshold',
  'thresholds',
  'target',
  'mutationScore',
  'high',
  'low',
  'break',
];

/**
 * Scans the whole line rather than anchoring at its start. A coverage gate is
 * usually one key per indented line, but it is just as legally written inline —
 * `coverage: { statements: 95 }` — and an anchored pattern reads that as no
 * threshold at all, which is exactly the shape someone would reach for to slip
 * one past. The `g` flag is applied per call so the regex keeps no lastIndex
 * between lines.
 */
const KEY_VALUE = /["']?\b([A-Za-z_][\w-]*)["']?\s*[:=]\s*["']?(-?\d[\d_]*(?:\.\d+)?)["']?/;

function thresholdEntries(text: string): { key: string; value: number }[] {
  const found: { key: string; value: number }[] = [];

  for (const match of text.matchAll(new RegExp(KEY_VALUE.source, 'g'))) {
    const key = match[1];
    const raw = match[2];
    if (key === undefined || raw === undefined) continue;
    if (!THRESHOLD_KEYS.includes(key)) continue;
    // `30_000` is a number in JS/TS source; without stripping the separator
    // it parses as 30 and every comparison against it is nonsense.
    found.push({ key, value: Number(raw.replace(/_/g, '')) });
  }

  return found;
}

function isConfigLike(file: DiffFile): boolean {
  return isThresholdConfig(file.path) || /\.config\.[cm]?[jt]s$/.test(file.path);
}

export const coverageThresholdLowered: Rule = {
  rule: 'COVERAGE_THRESHOLD_LOWERED',
  run(ctx: RuleContext): Finding[] {
    const findings: Finding[] = [];

    for (const file of ctx.files) {
      if (file.status === 'deleted' || !isConfigLike(file)) continue;

      for (const hunk of file.hunks) {
        const removed = new Map<string, { value: number; text: string }>();
        for (const line of hunk.lines) {
          if (line.kind !== 'del') continue;
          for (const entry of thresholdEntries(line.text)) {
            removed.set(entry.key, { value: entry.value, text: line.text });
          }
        }

        const seen = new Set<string>();
        for (const line of hunk.lines) {
          if (line.kind !== 'add') continue;

          for (const entry of thresholdEntries(line.text)) {
            seen.add(entry.key);
            const was = removed.get(entry.key);
            if (!was || entry.value >= was.value) continue;

            findings.push(
              finding({
                rule: 'COVERAGE_THRESHOLD_LOWERED',
                severity: 'high',
                file: file.path,
                /* c8 ignore next -- an added line always carries a post-image number */
                line: line.newLine ?? 1,
                message: `Threshold "${entry.key}" lowered from ${was.value} to ${entry.value}.`,
                before: was.text,
                after: line.text,
                fix_hint: 'Raise the number back and make the code meet it.',
              }),
            );
          }
        }

        // A threshold deleted outright is the same move with fewer steps.
        for (const [key, was] of removed) {
          if (seen.has(key)) continue;

          findings.push(
            finding({
              rule: 'COVERAGE_THRESHOLD_LOWERED',
              severity: 'high',
              file: file.path,
              line: 1,
              message: `Threshold "${key}" (was ${was.value}) removed.`,
              before: was.text,
              fix_hint:
                'Put the threshold back, or state in the commit why the gate is going away.',
            }),
          );
        }
      }
    }

    return findings;
  },
};

const TIMEOUT_KEY =
  /\b(timeout|testTimeout|hookTimeout|retries|retry|maxRetries)\b\s*[:=(]\s*["']?(\d[\d_]*)/;

export const testTimeoutRaised: Rule = {
  rule: 'TEST_TIMEOUT_RAISED',
  run(ctx: RuleContext): Finding[] {
    const findings: Finding[] = [];

    for (const file of ctx.files) {
      if (file.status === 'deleted') continue;
      if (!isTestFile(file.path) && !isConfigLike(file)) continue;

      for (const hunk of file.hunks) {
        const removed = new Map<string, number>();
        for (const line of hunk.lines) {
          if (line.kind !== 'del') continue;
          const m = TIMEOUT_KEY.exec(line.text);
          const key = m?.[1];
          const raw = m?.[2];
          if (key && raw !== undefined) removed.set(key, Number(raw.replace(/_/g, '')));
        }

        for (const line of hunk.lines) {
          if (line.kind !== 'add') continue;
          const m = TIMEOUT_KEY.exec(line.text);
          const key = m?.[1];
          const raw = m?.[2];
          if (!key || raw === undefined) continue;

          const was = removed.get(key);
          const now = Number(raw.replace(/_/g, ''));
          // Raised, or introduced where there was none. Both buy time for a
          // flaky test instead of fixing it — and both are ordinary tuning
          // often enough that this never blocks.
          if (was !== undefined && now <= was) continue;

          findings.push(
            finding({
              rule: 'TEST_TIMEOUT_RAISED',
              severity: 'low',
              file: file.path,
              line: line.newLine ?? 1,
              message:
                was === undefined
                  ? `"${key}" introduced at ${now}.`
                  : `"${key}" raised from ${was} to ${now}.`,
              ...(was === undefined
                ? {}
                : {
                    before:
                      hunk.lines.find((l) => l.kind === 'del' && TIMEOUT_KEY.test(l.text))?.text ??
                      '',
                  }),
              after: line.text,
              fix_hint: 'Worth checking the test is slow rather than racy.',
            }),
          );
        }
      }
    }

    return findings;
  },
};
