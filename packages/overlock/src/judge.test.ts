import { Worker } from 'node:worker_threads';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { analyze } from './analyze.js';
import { diffOf, hunk } from './__fixtures__/diffs.js';
import { parseDiff } from './diff.js';
import {
  JUDGE_DEFAULTS,
  candidates,
  createJudge,
  jevTransport,
  judgeFor,
  request,
  verdict,
  type Candidate,
  type JevRequest,
  type JevResponse,
  type Transport,
} from './judge.js';
import { isTestFile } from './paths.js';
import type { Finding } from './types.js';

const isTest = (path: string) => isTestFile(path, []);

/** The mock stops returning the error, and the assertion follows it. */
const WEAKENED = diffOf(
  'src/charge.test.ts',
  hunk(
    [
      " it('rejects an expired card', async () => {",
      '-  gateway.charge.mockRejectedValue(new CardExpired());',
      '+  gateway.charge.mockResolvedValue({ ok: true });',
      '   const result = await pay(order);',
      '-  expect(result.status).toBe("declined");',
      '+  expect(result).toBeTruthy();',
      ' });',
    ].join('\n'),
    10,
    10,
  ),
);

const ADDED_ONLY = diffOf(
  'src/cart.test.ts',
  hunk(
    [
      " it('totals the cart', () => {",
      '   expect(total(cart)).toBe(30);',
      '+  expect(cart.items).toHaveLength(2);',
      ' });',
    ].join('\n'),
  ),
);

const SOURCE = diffOf(
  'src/charge.ts',
  hunk(['-export const retries = 3;', '+export const retries = 4;'].join('\n')),
);

const answer = (noul: number, choice = 'weakened'): JevResponse => ({
  answers: { weakens: { noul }, kind: { choice, confidence: 0.9 } },
});

const always =
  (response: JevResponse | null): Transport =>
  (requests) =>
    requests.map(() => response);

const config = { ...JUDGE_DEFAULTS };

describe('candidates', () => {
  it('picks a test case that lost lines', () => {
    const [c] = candidates(parseDiff(WEAKENED), isTest, [], 10);
    expect(c).toMatchObject({
      file: 'src/charge.test.ts',
      subject: 'rejects an expired card',
      line: 11,
    });
    expect(c?.removed).toHaveLength(2);
    expect(c?.added).toHaveLength(2);
  });

  it('skips cases that only gained lines, source files and deleted files', () => {
    const deleted = diffOf(
      'src/old.test.ts',
      hunk(" it('x', () => {\n-  expect(1).toBe(1);\n });"),
      {
        status: 'deleted',
      },
    );
    expect(candidates(parseDiff(ADDED_ONLY + SOURCE + deleted), isTest, [], 10)).toEqual([]);
  });

  it('skips cases a rule already flagged at medium or above, by subject or by line', () => {
    const files = parseDiff(WEAKENED);
    const flagged = (over: Partial<Finding>): Finding => ({
      id: 'x',
      rule: 'ASSERTION_WEAKENED',
      severity: 'high',
      file: 'src/charge.test.ts',
      line: null,
      message: '',
      evidence: {},
      fix_hint: '',
      ...over,
    });
    expect(
      candidates(files, isTest, [flagged({ subject: 'rejects an expired card' })], 10),
    ).toEqual([]);
    expect(candidates(files, isTest, [flagged({ line: 13 })], 10)).toEqual([]);
    // Low findings are context, not a verdict, and do not cover a case.
    expect(candidates(files, isTest, [flagged({ severity: 'low', line: 13 })], 10)).toHaveLength(1);
  });

  it('sends the largest edits first, up to the cap', () => {
    const small = diffOf(
      'src/a.test.ts',
      hunk(" it('small', () => {\n-  expect(a).toBe(1);\n+  expect(a).toBe(2);\n });"),
    );
    const picked = candidates(parseDiff(small + WEAKENED), isTest, [], 1);
    expect(picked.map((c) => c.subject)).toEqual(['rejects an expired card']);
    expect(candidates(parseDiff(WEAKENED), isTest, [], -1)).toEqual([]);
  });
});

describe('request', () => {
  it('sends the changed lines of one case and two described questions', () => {
    const [c] = candidates(parseDiff(WEAKENED), isTest, [], 10) as [Candidate];
    const body = request(c, 'jev-1.13.0');
    expect(body.model).toBe('jev-1.13.0');
    expect(body.state).toMatchObject({
      file: 'src/charge.test.ts',
      test_case: 'rejects an expired card',
    });
    expect(body.questions.weakens?.type).toBe('noul');
    expect(Object.keys(body.questions.kind?.criteria ?? {})).toContain('weakened');
  });

  it('clips long cases and long lines', () => {
    const c: Candidate = {
      file: 'a.test.ts',
      subject: 's',
      line: 1,
      removed: Array.from({ length: 100 }, () => 'x'.repeat(400)),
      added: [],
    };
    const removed = request(c, 'm').state.removed_lines as string[];
    expect(removed).toHaveLength(60);
    expect(removed[0]).toHaveLength(301);
  });
});

describe('verdict', () => {
  const c: Candidate = {
    file: 'a.test.ts',
    subject: 'pays',
    line: 4,
    removed: ['-a'],
    added: ['+b'],
  };

  it('reports only when both questions agree above the threshold', () => {
    const f = verdict(c, answer(0.93), 0.8);
    expect(f).toMatchObject({
      rule: 'JUDGED_WEAKENING',
      severity: 'medium',
      file: 'a.test.ts',
      line: 4,
      subject: 'pays',
      evidence: { before: '-a', after: '+b' },
    });
    expect(f?.message).toContain('p=0.93');
    expect(verdict(c, answer(0.79), 0.8)).toBeNull();
    expect(verdict(c, answer(0.99, 'refactor'), 0.8)).toBeNull();
    expect(verdict(c, answer(Number.NaN), 0.8)).toBeNull();
    expect(verdict(c, { answers: {} }, 0.8)).toBeNull();
    expect(verdict(c, null, 0.8)).toBeNull();
  });

  it('omits evidence a case does not have', () => {
    expect(verdict({ ...c, removed: [], added: [] }, answer(0.9), 0.8)?.evidence).toEqual({});
  });
});

describe('createJudge', () => {
  const files = parseDiff(WEAKENED);

  it('does not call out when nothing is worth asking about', () => {
    let called = false;
    const judge = createJudge(config, () => {
      called = true;
      return [];
    });
    expect(judge(parseDiff(ADDED_ONLY), isTest, []).summary).toEqual({
      model: 'jev-1.13.0',
      cases: 0,
      answered: 0,
      flagged: 0,
    });
    expect(called).toBe(false);
  });

  it('counts what was asked, answered and flagged', () => {
    const { findings, summary } = createJudge(config, always(answer(0.95)))(files, isTest, []);
    expect(findings).toHaveLength(1);
    expect(summary).toEqual({ model: 'jev-1.13.0', cases: 1, answered: 1, flagged: 1 });
  });

  it('never throws: a failed transport is reported, not raised', () => {
    const broken = createJudge(config, () => {
      throw new TypeError('boom');
    });
    expect(broken(files, isTest, []).summary.error).toBe('TypeError');
    const odd = createJudge(config, () => {
      throw 'not an error';
    });
    expect(odd(files, isTest, []).summary.error).toBe('UnknownError');
  });

  it('says so when the service answered nothing', () => {
    expect(createJudge(config, always(null))(files, isTest, []).summary.error).toBe('NoAnswers');
    expect(createJudge(config, () => [])(files, isTest, []).summary.error).toBe('NoAnswers');
  });
});

describe('judgeFor', () => {
  it('is off unless settings are given, and off under the kill switch', () => {
    expect(judgeFor(undefined, {})).toBeUndefined();
    expect(judgeFor({}, { OVERLOCK_NO_JUDGE: '1', TYPESAFE_API_KEY: 'k' })).toBeUndefined();
  });

  it('reports a missing key instead of silently not judging', () => {
    const judge = judgeFor({ model: 'jev-latest' }, {});
    expect(judge?.(parseDiff(WEAKENED), isTest, []).summary).toEqual({
      model: 'jev-latest',
      cases: 1,
      answered: 0,
      flagged: 0,
      error: 'TYPESAFE_API_KEY is not set',
    });
  });

  it('uses a given transport, and builds the real one from a key', () => {
    const judge = judgeFor({ threshold: 0.5 }, {}, always(answer(0.6)));
    expect(judge?.(parseDiff(WEAKENED), isTest, []).findings).toHaveLength(1);
    expect(judgeFor({}, { TYPESAFE_API_KEY: 'k' })).toBeTypeOf('function');
  });
});

describe('analyze with a judge', () => {
  const judge = createJudge(config, always(answer(0.95)));

  it('adds judged findings to the report and records what the judge did', () => {
    const report = analyze({ diff: WEAKENED + SOURCE, judge });
    expect(report.findings.map((f) => f.rule)).toContain('JUDGED_WEAKENING');
    expect(report.judge).toMatchObject({ cases: 1, flagged: 1 });
    expect(report.ok).toBe(true);
  });

  it('puts judged findings under the same policy as the rules', () => {
    const high = analyze({ diff: WEAKENED, judge, severities: { JUDGED_WEAKENING: 'high' } });
    expect(high.ok).toBe(false);
    const off = analyze({ diff: WEAKENED, judge, severities: { JUDGED_WEAKENING: 'off' } });
    expect(off.findings).toEqual([]);
    expect(off.silenced).toBe(1);
  });

  it('honours an inline suppression', () => {
    const suppressed = diffOf(
      'src/charge.test.ts',
      hunk(
        [
          " it('rejects an expired card', async () => {",
          '-  gateway.charge.mockRejectedValue(new CardExpired());',
          '+  gateway.charge.mockResolvedValue({ ok: true }); // overlock-ignore JUDGED_WEAKENING -- the gateway no longer declines here',
          ' });',
        ].join('\n'),
      ),
    );
    const report = analyze({ diff: suppressed, judge });
    expect(report.findings).toEqual([]);
    expect(report.suppressed).toBe(1);
  });

  it('leaves the report without a judge section when none ran', () => {
    expect(analyze({ diff: WEAKENED }).judge).toBeUndefined();
  });
});

/**
 * The real transport against a real server. The server lives on a worker
 * thread because the transport blocks this one until the child answers.
 */
describe('jevTransport', () => {
  let worker: Worker;
  let endpoint: string;

  beforeAll(async () => {
    worker = new Worker(
      `
      const { createServer } = require('node:http');
      const { parentPort } = require('node:worker_threads');
      const server = createServer((req, res) => {
        let body = '';
        req.on('data', (c) => (body += c));
        req.on('end', () => {
          const parsed = JSON.parse(body);
          if (req.headers.authorization !== 'Bearer secret') { res.writeHead(401); return res.end(); }
          if (parsed.state.test_case === 'fails') { res.writeHead(529); return res.end(); }
          if (parsed.state.test_case === 'hangs') return;
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ model: 'jev-1.13.0', answers: { weakens: { noul: 0.9 }, kind: { choice: 'weakened' } } }));
        });
      });
      server.listen(0, '127.0.0.1', () => parentPort.postMessage(server.address().port));
      `,
      { eval: true },
    );
    const port = await new Promise<number>((resolve) => worker.once('message', resolve));
    endpoint = `http://127.0.0.1:${port}/v1/systemone`;
  });

  afterAll(async () => {
    await worker.terminate();
  });

  const body = (test_case: string): JevRequest => ({
    model: 'm',
    state: { test_case },
    questions: {},
  });

  it('answers in order, with null for each request that failed', () => {
    const send = jevTransport('secret', { ...config, endpoint, timeoutMs: 1000 });
    const [ok, failed, hung] = send([body('ok'), body('fails'), body('hangs')]);
    expect(ok?.answers?.weakens?.noul).toBe(0.9);
    expect(failed).toBeNull();
    expect(hung).toBeNull();
  });

  it('treats a rejected key as no answer', () => {
    expect(jevTransport('wrong', { ...config, endpoint })([body('ok')])).toEqual([null]);
  });

  it('turns an endpoint it cannot reach into no answer', () => {
    const send = jevTransport('secret', { ...config, endpoint: 'data:,' });
    expect(send([body('ok')])).toEqual([null]);
  });
});
