import { afterEach, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  evaluationSummary,
  evaluationMarkdown,
  readEvaluation,
  replay,
  importEvaluation,
  parseEvaluationRun,
  parseEvaluationReview,
} from './evaluation.js';
import type { EvaluationRun } from './evaluation-record.js';
import { fingerprint } from './evaluation-record.js';
import { diffOf, hunk } from './__fixtures__/diffs.js';

const dirs: string[] = [];
function temp(): string {
  const dir = mkdtempSync(join(tmpdir(), 'overlock-eval-'));
  dirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true });
});
const record = (id: string, source = 'hook'): EvaluationRun => ({
  schema: 2,
  run_id: id,
  session: 'session',
  timestamp: '2026-09-10T00:00:00Z',
  repository: 'test',
  version: '0.7.0',
  build: 'abc',
  source,
  environment: 'local',
  branch: 'feature',
  base: 'base',
  head: 'head',
  patch: 'patch',
  settings: {
    base: 'main',
    baseMode: 'fork-point',
    staged: false,
    failOn: 'high',
    failOnEmpty: false,
    severity: {},
    testGlob: [],
    untracked: true,
  },
  scope: { files: 1, commits: 1 },
  duration_ms: 12,
  status: 'analyzed',
  decision: 'block',
  exit_code: 2,
  error: null,
  findings: [
    {
      key: 'key',
      disposition: 'standing',
      finding: {
        id: 'id',
        rule: 'TEST_SKIPPED_ADDED',
        severity: 'high',
        file: 'a.test.ts',
        line: 1,
        message: 'skip',
        evidence: { after: 'it.skip()' },
        fix_hint: 'fix',
      },
    },
  ],
});

it('deduplicates imports and findings, separates probes, and refuses to call detections saves', () => {
  const rows = [record('one'), record('two'), record('one'), record('probe', 'probe')];
  const report = evaluationSummary(rows, []);
  expect(report.runs).toBe(3);
  expect(report.probe_runs).toBe(1);
  expect(report.distinct_findings).toBe(1);
  expect(report.useful_corrections).toBe(0);
  expect(report.reviewed_high).toBe(0);
  expect(report.block_precision).toBeNull();
  expect(evaluationMarkdown(report)).toContain('Unreviewed');
});

it('counts reviewed outcomes once, and rejects duplicate or orphaned reviews', () => {
  const review = {
    schema: 1 as const,
    finding: 'key',
    label: 'useful_correction' as const,
    reason: 'Restored an expired-token check',
    reviewer: 'owner',
    warranted_block: true,
    minutes: 2,
    resolution: 'commit-sha',
  };
  const report = evaluationSummary([record('one'), record('two')], [review]);
  expect(report.useful_corrections).toBe(1);
  expect(report.block_precision).toBe(1);
  expect(report.review_minutes).toBe(2);
  expect(() => evaluationSummary([record('one')], [review, review])).toThrow(/Duplicate/);
  expect(() => evaluationSummary([], [review])).toThrow(/Unknown finding/);
});

it('reads portable run and review shards and rejects truncated records', () => {
  const dir = temp();
  expect(readEvaluation(dir)).toEqual({ runs: [], reviews: [] });
  mkdirSync(join(dir, 'runs'));
  writeFileSync(join(dir, 'runs/a.jsonl'), JSON.stringify(record('one')) + '\n');
  expect(readEvaluation(dir).runs).toHaveLength(1);
  writeFileSync(join(dir, 'runs/b.jsonl'), '{');
  expect(() => readEvaluation(dir)).toThrow(/b.jsonl/);
});

it('replays labeled probes without scoring historical examples lacking independent labels', () => {
  const dir = temp();
  writeFileSync(join(dir, 'skip.diff'), diffOf('a.test.ts', hunk("+it.skip('x', () => {});")));
  const cases = [
    {
      id: 'skip',
      diff: 'skip.diff',
      kind: 'probe',
      split: 'development',
      expected: ['TEST_SKIPPED_ADDED'],
    },
    {
      id: 'miss',
      diff: 'skip.diff',
      kind: 'probe',
      split: 'holdout',
      expected: ['ASSERTION_WEAKENED'],
    },
    { id: 'history', diff: 'skip.diff', kind: 'historical', split: 'holdout', expected: null },
  ];
  const path = join(dir, 'manifest.json');
  writeFileSync(path, JSON.stringify({ schema: 1, cases }));
  const result = replay(path);
  expect(result.scored).toBe(2);
  expect(result.matched).toBe(1);
  expect(result.results[1]?.missing).toEqual(['ASSERTION_WEAKENED']);
  expect(result.results[2]?.matched).toBeNull();
  cases[0]!.diff = '../outside.diff';
  writeFileSync(path, JSON.stringify({ schema: 1, cases }));
  expect(() => replay(path)).toThrow(/inside/);
});

it('imports artifacts idempotently and refuses a changed record with the same ID', () => {
  const dir = temp();
  const output = temp();
  const file = join(dir, 'ci.jsonl');
  writeFileSync(file, JSON.stringify(record('ci')) + '\n');
  expect(importEvaluation(dir, output)).toBe(1);
  expect(importEvaluation(file, output)).toBe(0);
  expect(readEvaluation(output).runs).toEqual([record('ci')]);
  writeFileSync(file, JSON.stringify({ ...record('ci'), exit_code: 1 }));
  expect(() => importEvaluation(file, output)).toThrow(/Conflicting/);
  expect(() => importEvaluation(temp(), output)).toThrow(/No .jsonl/);
});

it('imports captured patches only when their content matches their name', () => {
  const dir = temp();
  const output = temp();
  mkdirSync(join(dir, 'runs'));
  mkdirSync(join(dir, 'patches'));
  writeFileSync(join(dir, 'runs/ci.jsonl'), JSON.stringify(record('ci')));
  const name = fingerprint('patch') + '.diff';
  writeFileSync(join(dir, 'patches', name), 'patch');
  expect(importEvaluation(dir, output)).toBe(1);
  expect(readFileSync(join(output, 'patches', name), 'utf8')).toBe('patch');
  writeFileSync(join(dir, 'patches', name), 'changed');
  expect(() => importEvaluation(dir, output)).toThrow(/hash mismatch/);
});

it('scores detector accuracy separately from whether a block was warranted', () => {
  const dir = temp();
  const path = join(dir, 'manifest.json');
  writeFileSync(join(dir, 'a.diff'), diffOf('a.test.ts', hunk("+it.skip('x', () => {});")));
  const cases = [
    {
      id: 'skip',
      diff: 'a.diff',
      kind: 'probe',
      split: 'holdout',
      expected: ['TEST_SKIPPED_ADDED'],
      expected_block: false,
    },
  ];
  writeFileSync(path, JSON.stringify({ schema: 1, cases }));
  expect(replay(path)).toMatchObject({
    scored: 1,
    matched: 1,
    blocking_scored: 1,
    blocking_matched: 0,
  });
  cases[0]!.expected_block = true;
  writeFileSync(path, JSON.stringify({ schema: 1, cases }));
  expect(replay(path).blocking_matched).toBe(1);
  writeFileSync(path, JSON.stringify({ schema: 1, cases: [{ ...cases[0], expected_block: 3 }] }));
  expect(() => replay(path)).toThrow(/expected_block/);
});

it('validates persisted records instead of accepting partial or legacy telemetry', () => {
  expect(parseEvaluationRun(record('one'))).toEqual(record('one'));
  const invalid = [
    null,
    [],
    {},
    { ...record('one'), schema: 1 },
    ...[
      'run_id',
      'repository',
      'session',
      'version',
      'build',
      'source',
      'environment',
      'timestamp',
    ].map((key) => ({ ...record('one'), [key]: '' })),
    ...['status', 'decision', 'exit_code', 'duration_ms', 'settings', 'findings'].map((key) => ({
      ...record('one'),
      [key]: null,
    })),
    { ...record('one'), findings: [{}] },
    ...['key', 'disposition', 'finding'].map((key) => ({
      ...record('one'),
      findings: [{ ...record('one').findings[0], [key]: null }],
    })),
    ...['rule', 'severity', 'file', 'evidence'].map((key) => ({
      ...record('one'),
      findings: [
        {
          ...record('one').findings[0],
          finding: { ...record('one').findings[0]!.finding, [key]: null },
        },
      ],
    })),
  ];
  for (const value of invalid) expect(() => parseEvaluationRun(value)).toThrow();
  expect(() => evaluationSummary([record('one'), { ...record('one'), exit_code: 1 }], [])).toThrow(
    /Conflicting/,
  );
});

it('requires independent review evidence and counts duplicate patches as one correction', () => {
  const base = {
    schema: 1,
    finding: 'key',
    label: 'false_alarm',
    reason: 'A supported feature was retired',
    reviewer: 'owner',
    warranted_block: false,
    minutes: 3,
  };
  for (const key of [
    'schema',
    'finding',
    'label',
    'reason',
    'reviewer',
    'warranted_block',
    'minutes',
  ]) {
    expect(() => parseEvaluationReview({ ...base, [key]: null })).toThrow();
  }
  expect(() => parseEvaluationReview({ ...base, label: 'useful_correction' })).toThrow(/resolving/);
  expect(() => parseEvaluationReview({ ...base, duplicate_of: '' })).toThrow();
  expect(() => parseEvaluationReview({ ...base, resolution: '' })).toThrow();
  const review = parseEvaluationReview(base);
  const second = { ...record('two'), findings: [{ ...record('two').findings[0]!, key: 'second' }] };
  const duplicate = { ...review, finding: 'second', duplicate_of: 'key' };
  const data = evaluationSummary([record('one'), second], [review, duplicate]);
  expect(data.false_alarms).toBe(1);
  expect(data.possible_duplicates).toEqual([['key', 'second']]);
  expect(data.review_minutes).toBe(6);
  expect(evaluationMarkdown(data)).toContain('0%');
  expect(() =>
    evaluationSummary([record('one')], [{ ...review, duplicate_of: 'missing' }]),
  ).toThrow(/canonical/);
  const dir = temp();
  mkdirSync(join(dir, 'reviews'));
  writeFileSync(join(dir, 'reviews/owner.json'), JSON.stringify(base));
  expect(readEvaluation(dir).reviews).toEqual([review]);
  expect(evaluationSummary([], [{ ...review, label: 'missed' }]).identified_misses).toBe(1);
  expect(
    evaluationSummary([record('one')], [{ ...review, label: 'legitimate_change' }])
      .legitimate_changes,
  ).toBe(1);
  expect(evaluationMarkdown(evaluationSummary([], []))).toContain('Builds: none');
});

it('reports operational failures, empty checks, and retry bypasses separately', () => {
  const rows = [
    record('one'),
    { ...record('two'), status: 'error' as const, decision: 'error' as const },
    { ...record('three'), status: 'empty' as const, decision: 'retry_bypass' as const },
    { ...record('four'), decision: 'suppression_block' as const },
  ];
  expect(evaluationSummary(rows, [])).toMatchObject({
    errors: 1,
    empty: 1,
    retry_bypasses: 1,
    blocks: 2,
  });
});

it('rejects invalid corpus oracles and duplicate case identities', () => {
  const dir = temp();
  const path = join(dir, 'manifest.json');
  const entry = { id: 'one', diff: 'a.diff', kind: 'probe', split: 'holdout', expected: [] };
  writeFileSync(join(dir, 'a.diff'), '');
  for (const value of [
    {},
    { schema: 1, cases: [{}] },
    ...['id', 'diff', 'kind', 'split', 'expected'].map((key) => ({
      schema: 1,
      cases: [{ ...entry, [key]: 1 }],
    })),
    { schema: 1, cases: [{ ...entry, expected: ['UNKNOWN'] }] },
    { schema: 1, cases: [entry, entry] },
  ]) {
    writeFileSync(path, JSON.stringify(value));
    expect(() => replay(path)).toThrow();
  }
});
