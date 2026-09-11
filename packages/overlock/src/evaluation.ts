import {
  existsSync,
  readdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
  mkdirSync,
} from 'node:fs';
import { basename, dirname, join, relative, resolve, isAbsolute } from 'node:path';
import { analyze } from './analyze.js';
import { BUILD, VERSION, fingerprint, type EvaluationRun } from './evaluation-record.js';
import { RULE_IDS, type RuleId } from './types.js';

export interface EvaluationReview {
  schema: 1;
  finding: string;
  label: 'useful_correction' | 'legitimate_change' | 'false_alarm' | 'missed';
  reason: string;
  reviewer: string;
  warranted_block: boolean;
  minutes: number;
  resolution?: string;
  /** Link a revised patch to an already reviewed finding, rather than count it twice. */
  duplicate_of?: string;
}

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function nonempty(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}
function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
function jsonFile(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8')) as unknown;
}

export function parseEvaluationRun(value: unknown): EvaluationRun {
  check(
    object(value) &&
      value.schema === 2 &&
      nonempty(value.run_id) &&
      nonempty(value.repository) &&
      nonempty(value.session) &&
      nonempty(value.version) &&
      nonempty(value.build) &&
      nonempty(value.source) &&
      nonempty(value.environment) &&
      typeof value.timestamp === 'string' &&
      Number.isFinite(Date.parse(value.timestamp)) &&
      ['analyzed', 'empty', 'error'].includes(String(value.status)) &&
      ['pass', 'fail', 'block', 'suppression_block', 'retry_bypass', 'error'].includes(
        String(value.decision),
      ) &&
      Number.isInteger(value.exit_code) &&
      typeof value.duration_ms === 'number' &&
      value.duration_ms >= 0 &&
      object(value.settings) &&
      Array.isArray(value.findings),
    'Invalid schema-2 evaluation run',
  );
  for (const item of value.findings) {
    check(
      object(item) &&
        nonempty(item.key) &&
        ['standing', 'suppressed', 'off'].includes(String(item.disposition)) &&
        object(item.finding) &&
        RULE_IDS.includes(item.finding.rule as RuleId) &&
        ['high', 'medium', 'low'].includes(String(item.finding.severity)) &&
        nonempty(item.finding.file) &&
        object(item.finding.evidence),
      'Invalid evaluation finding',
    );
  }
  return value as unknown as EvaluationRun;
}

export function parseEvaluationReview(value: unknown): EvaluationReview {
  check(
    object(value) &&
      value.schema === 1 &&
      nonempty(value.finding) &&
      ['useful_correction', 'legitimate_change', 'false_alarm', 'missed'].includes(
        String(value.label),
      ) &&
      nonempty(value.reason) &&
      nonempty(value.reviewer) &&
      typeof value.warranted_block === 'boolean' &&
      typeof value.minutes === 'number' &&
      Number.isFinite(value.minutes) &&
      value.minutes >= 0 &&
      (value.duplicate_of === undefined || nonempty(value.duplicate_of)) &&
      (value.resolution === undefined || nonempty(value.resolution)),
    'Invalid evaluation review',
  );
  check(
    value.label !== 'useful_correction' || nonempty(value.resolution),
    'A useful correction needs a resolving commit or evidence reference',
  );
  return value as unknown as EvaluationReview;
}

/** Never quietly drop a partial artifact and then report an inflated success rate. */
export function readRunFile(path: string): EvaluationRun[] {
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter((line) => line.trim())
    .map((line, index) => {
      try {
        return parseEvaluationRun(JSON.parse(line) as unknown);
      } catch (error) {
        throw new Error(`${path}:${index + 1}: invalid evaluation record`, { cause: error });
      }
    });
}

function files(directory: string, extension: string): string[] {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(extension))
    .map((entry) => join(directory, entry.name))
    .sort();
}

export function readEvaluation(directory: string): {
  runs: EvaluationRun[];
  reviews: EvaluationReview[];
} {
  return {
    runs: files(join(directory, 'runs'), '.jsonl').flatMap(readRunFile),
    reviews: files(join(directory, 'reviews'), '.json').map((path) =>
      parseEvaluationReview(jsonFile(path)),
    ),
  };
}

/** Import artifacts explicitly; neither CI nor a hook commits to the caller's branch. */
export function importEvaluation(source: string, directory: string): number {
  const paths = source.endsWith('.jsonl')
    ? [source]
    : files(existsSync(join(source, 'runs')) ? join(source, 'runs') : source, '.jsonl');
  check(paths.length > 0, 'No .jsonl artifacts found');
  const runs = paths.flatMap(readRunFile);
  const patches = files(join(source, 'patches'), '.diff').map((path) => {
    const diff = readFileSync(path, 'utf8');
    const name = `${fingerprint(diff)}.diff`;
    check(basename(path) === name, `Snapshot hash mismatch: ${path}`);
    return { name, diff };
  });
  const destination = join(directory, 'runs');
  mkdirSync(destination, { recursive: true });
  const existing = new Map(
    files(destination, '.jsonl')
      .flatMap(readRunFile)
      .map((record) => [record.run_id, JSON.stringify(record)]),
  );
  let added = 0;
  if (patches.length) {
    mkdirSync(join(directory, 'patches'), { recursive: true });
    for (const patch of patches) writeFileSync(join(directory, 'patches', patch.name), patch.diff);
  }
  for (const record of runs) {
    const path = join(destination, `import-${fingerprint(record.run_id)}.jsonl`);
    const content = JSON.stringify(record) + '\n';
    const previous = existing.get(record.run_id);
    if (previous !== undefined) {
      check(previous + '\n' === content, `Conflicting run ID: ${record.run_id}`);
      continue;
    }
    writeFileSync(path, content, { flag: 'wx' });
    existing.set(record.run_id, JSON.stringify(record));
    added++;
  }
  return added;
}

export function evaluationSummary(records: EvaluationRun[], reviews: EvaluationReview[]) {
  const runs = new Map<string, EvaluationRun>();
  for (const record of records) {
    const previous = runs.get(record.run_id);
    check(
      !previous || JSON.stringify(previous) === JSON.stringify(record),
      `Conflicting run ID: ${record.run_id}`,
    );
    runs.set(record.run_id, record);
  }
  const organic = [...runs.values()]
    .filter((r) => r.source !== 'probe')
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp) || a.run_id.localeCompare(b.run_id));
  const detections = new Map(organic.flatMap((r) => r.findings.map((f) => [f.key, f] as const)));
  const related = new Map<string, Set<string>>();
  for (const run of organic) {
    for (const item of run.findings) {
      const f = item.finding;
      const signature = fingerprint(
        JSON.stringify([run.repository, f.rule, f.file, f.subject, f.evidence]),
      );
      const keys = related.get(signature) ?? new Set<string>();
      keys.add(item.key);
      related.set(signature, keys);
    }
  }
  const labeled = new Map<string, EvaluationReview>();
  for (const review of reviews) {
    check(!labeled.has(review.finding), `Duplicate review: ${review.finding}`);
    check(
      review.label === 'missed' || detections.has(review.finding),
      `Unknown finding: ${review.finding}`,
    );
    labeled.set(review.finding, review);
  }
  for (const review of reviews) {
    if (review.duplicate_of !== undefined) {
      const target = labeled.get(review.duplicate_of);
      check(
        target && target.finding !== review.finding && !target.duplicate_of,
        `duplicate_of must name one canonical review: ${review.finding}`,
      );
    }
  }
  const canonical = reviews.filter((r) => !r.duplicate_of);
  const high = canonical.filter((r) => detections.get(r.finding)?.finding.severity === 'high');
  const byRule = RULE_IDS.map((rule) => {
    const findings = [...detections.values()].filter((f) => f.finding.rule === rule);
    const reviewed = canonical.filter((r) => detections.get(r.finding)?.finding.rule === rule);
    return {
      rule,
      distinct: findings.length,
      reviewed: reviewed.length,
      useful: reviewed.filter((r) => r.label === 'useful_correction').length,
      false_alarms: reviewed.filter((r) => r.label === 'false_alarm').length,
    };
  }).filter((r) => r.distinct > 0);
  return {
    runs: runs.size,
    organic_runs: organic.length,
    probe_runs: runs.size - organic.length,
    builds: [...new Set(organic.map((r) => `${r.version}/${r.build}`))].sort(),
    distinct_patches: new Set(
      organic.filter((r) => r.status === 'analyzed').map((r) => `${r.repository}:${r.patch}`),
    ).size,
    distinct_findings: detections.size,
    unreviewed: [...detections.keys()].filter((key) => !labeled.has(key)).length,
    useful_corrections: canonical.filter((r) => r.label === 'useful_correction').length,
    legitimate_changes: canonical.filter((r) => r.label === 'legitimate_change').length,
    false_alarms: canonical.filter((r) => r.label === 'false_alarm').length,
    identified_misses: canonical.filter((r) => r.label === 'missed').length,
    reviewed_high: high.length,
    block_precision: high.length
      ? high.filter((r) => r.warranted_block).length / high.length
      : null,
    review_minutes: reviews.reduce((total, r) => total + r.minutes, 0),
    blocks: organic.filter((r) => r.decision === 'block' || r.decision === 'suppression_block')
      .length,
    retry_bypasses: organic.filter((r) => r.decision === 'retry_bypass').length,
    errors: organic.filter((r) => r.status === 'error').length,
    empty: organic.filter((r) => r.status === 'empty').length,
    by_rule: byRule,
    findings: [...detections.values()],
    possible_duplicates: [...related.values()]
      .filter((keys) => keys.size > 1)
      .map((keys) => [...keys]),
  };
}

export function evaluationMarkdown(summary: ReturnType<typeof evaluationSummary>): string {
  return [
    '# Overlock evaluation',
    '',
    `${summary.organic_runs} organic runs; ${summary.probe_runs} probe runs; ${summary.distinct_patches} distinct nonempty patches.`,
    '',
    '| Measure | Count |',
    '| --- | ---: |',
    `| Distinct findings | ${summary.distinct_findings} |`,
    `| Unreviewed | ${summary.unreviewed} |`,
    `| Useful corrections | ${summary.useful_corrections} |`,
    `| Legitimate changes | ${summary.legitimate_changes} |`,
    `| False alarms | ${summary.false_alarms} |`,
    `| Identified misses | ${summary.identified_misses} |`,
    `| Actual blocks | ${summary.blocks} |`,
    `| Retry bypasses | ${summary.retry_bypasses} |`,
    `| Errors / empty runs | ${summary.errors} / ${summary.empty} |`,
    `| Review minutes | ${summary.review_minutes} |`,
    '',
    `Blocking warranted: ${summary.block_precision === null ? 'unmeasured' : `${Math.round(summary.block_precision * 100)}%`} (${summary.reviewed_high} reviewed high findings).`,
    '',
    'Run counts are exposure, not saves. No success verdict is inferred from detections. Compare builds separately before changing policy.',
    '',
    '| Rule | Distinct | Reviewed | Useful | False alarms |',
    '| --- | ---: | ---: | ---: | ---: |',
    ...summary.by_rule.map(
      (r) => `| ${r.rule} | ${r.distinct} | ${r.reviewed} | ${r.useful} | ${r.false_alarms} |`,
    ),
    '',
    `Builds: ${summary.builds.join(', ') || 'none'}`,
    '',
  ].join('\n');
}

/** A corpus carries explicit oracles; unlabeled history is never scored as clean. */
export function replay(manifest: string) {
  const data = jsonFile(manifest);
  check(object(data) && data.schema === 1 && Array.isArray(data.cases), 'Invalid replay manifest');
  const root = realpathSync(dirname(resolve(manifest)));
  const ids = new Set<string>();
  const results = data.cases.map((entry: unknown) => {
    check(
      object(entry) &&
        nonempty(entry.id) &&
        nonempty(entry.diff) &&
        ['probe', 'historical'].includes(String(entry.kind)) &&
        ['development', 'holdout'].includes(String(entry.split)) &&
        (entry.expected === null ||
          (Array.isArray(entry.expected) &&
            entry.expected.every((r) => RULE_IDS.includes(r as RuleId)))),
      'Invalid replay case',
    );
    check(!ids.has(entry.id), `Duplicate replay case: ${entry.id}`);
    ids.add(entry.id);
    const candidate = resolve(root, entry.diff);
    const rel = relative(root, candidate);
    check(
      rel !== '..' && !rel.startsWith('../') && !isAbsolute(rel),
      'Replay diffs must stay inside the corpus',
    );
    const actual = relative(root, realpathSync(candidate));
    check(
      actual !== '..' && !actual.startsWith('../') && !isAbsolute(actual),
      'Replay diffs must stay inside the corpus',
    );
    const diff = readFileSync(candidate, 'utf8');
    const report = analyze({ diff });
    const found = [
      ...new Set(report.findings.filter((f) => f.severity !== 'low').map((f) => f.rule)),
    ].sort();
    const expected = entry.expected as RuleId[] | null;
    check(
      entry.expected_block === undefined ||
        entry.expected_block === null ||
        typeof entry.expected_block === 'boolean',
      'expected_block must be boolean or null',
    );
    const missing = expected?.filter((rule) => !found.includes(rule)) ?? [];
    const unexpected = expected === null ? [] : found.filter((rule) => !expected.includes(rule));
    return {
      id: entry.id,
      kind: entry.kind,
      split: entry.split,
      patch: fingerprint(diff),
      expected,
      found,
      missing,
      unexpected,
      matched: expected === null ? null : missing.length === 0 && unexpected.length === 0,
      blocked: !report.ok,
      expected_block: entry.expected_block ?? null,
      block_matched:
        typeof entry.expected_block === 'boolean' ? !report.ok === entry.expected_block : null,
    };
  });
  return {
    schema: 1,
    version: VERSION,
    build: BUILD,
    scored: results.filter((r) => r.matched !== null).length,
    matched: results.filter((r) => r.matched === true).length,
    blocking_scored: results.filter((r) => r.block_matched !== null).length,
    blocking_matched: results.filter((r) => r.block_matched === true).length,
    results,
  };
}
