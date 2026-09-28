/**
 * A second opinion from a model, for the weakening the rules cannot name.
 *
 * The rules are regexes over a diff, and that is their strength: they never
 * guess. It is also their ceiling. A test that stops exercising the failing
 * branch, a mock rewritten to return what the assertion expects, an exact
 * expectation replaced by three looser ones — each is an edit no pattern can
 * tell from an honest refactor, and each is the edit an agent under pressure
 * actually makes.
 *
 * So this only ever adds. The rules run first and their verdict stands; the
 * judge looks at the changed test cases none of them already flagged and
 * reports JUDGED_WEAKENING where the model is confident on two independent
 * questions at once. It is off unless a repository asks for it, it sends only
 * the changed lines of test files, and any failure — no key, a timeout, a bad
 * response — leaves the deterministic report exactly as it would have been.
 *
 * The call is made in a child process rather than with an awaited `fetch`,
 * which keeps `run()` synchronous for every caller that never enables this,
 * and gives the timeout teeth: a hung socket is killed with the process.
 */
import { execFileSync } from 'node:child_process';
import { byCase } from './rules/cases.js';
import { finding } from './rules/shared.js';
import type { DiffFile, Finding, JudgeSummary } from './types.js';

export interface JudgeConfig {
  /** Pinned by default: an alias that moves on release is a gate that moves. */
  model: string;
  /** Minimum probability on the weakening question. */
  threshold: number;
  /** The most cases sent per run, largest edits first. */
  maxCases: number;
  timeoutMs: number;
  endpoint: string;
}

export const JUDGE_DEFAULTS: JudgeConfig = {
  model: 'jev-1.13.0',
  threshold: 0.8,
  maxCases: 12,
  timeoutMs: 4000,
  endpoint: 'https://api.typesafe.ai/v1/systemone',
};

/** The environment variable the key is read from. Never a config key. */
export const JUDGE_KEY_ENV = 'TYPESAFE_API_KEY';

export interface Candidate {
  file: string;
  subject: string;
  line: number;
  removed: string[];
  added: string[];
}

/** Enough of a case to judge it, not enough to ship the file. */
const MAX_LINES = 60;
const MAX_LINE = 300;

const clip = (lines: string[]): string[] =>
  lines.slice(0, MAX_LINES).map((l) => (l.length > MAX_LINE ? `${l.slice(0, MAX_LINE)}…` : l));

/**
 * Changed test cases worth a second look.
 *
 * Only cases that lost a line: a case that only gained lines checks more than
 * it did, and asking about it spends the budget where nothing can be hiding.
 * Cases a rule already flagged at medium or above are skipped — the judge is
 * for what the rules missed, not a second vote on what they caught.
 */
export function candidates(
  files: DiffFile[],
  isTest: (path: string) => boolean,
  produced: Finding[],
  max: number,
): Candidate[] {
  const covered = new Set<string>();
  for (const f of produced) {
    if (f.severity === 'low') continue;
    if (f.subject !== undefined) covered.add(`${f.file}\0${f.subject}`);
    if (f.line !== null) covered.add(`${f.file}\0@${f.line}`);
  }

  const found: Candidate[] = [];
  for (const file of files) {
    if (file.status === 'deleted' || !isTest(file.path)) continue;
    for (const [subject, delta] of byCase(file)) {
      if (delta.dels.length === 0) continue;
      if (covered.has(`${file.path}\0${subject}`)) continue;
      const lines = [
        ...delta.adds.map((l) => l.newLine),
        ...delta.dels.map((l) => l.oldLine),
      ].filter((n): n is number => n !== null);
      if (lines.some((n) => covered.has(`${file.path}\0@${n}`))) continue;
      found.push({
        file: file.path,
        subject,
        line: delta.adds[0]?.newLine ?? delta.dels[0]?.oldLine ?? 1,
        removed: delta.dels.map((l) => l.text),
        added: delta.adds.map((l) => l.text),
      });
    }
  }

  return found.sort((a, b) => b.removed.length - a.removed.length).slice(0, Math.max(0, max));
}

interface JevQuestion {
  type: 'noul' | 'choice';
  instructions: string;
  criteria?: Record<string, string>;
}

export interface JevRequest {
  model: string;
  state: Record<string, unknown>;
  questions: Record<string, JevQuestion>;
}

export interface JevResponse {
  model?: string;
  answers?: Record<string, { noul?: number; choice?: string; confidence?: number }>;
}

/**
 * Descriptions rather than bare labels, and every label spelled out: the model
 * is measurably swayed by option names alone, and a description is what
 * anchors it to the meaning.
 */
const KINDS: Record<string, string> = {
  refactor:
    'The same checks, rewritten: renamed, reformatted, moved, split, or expressed with an equivalent matcher. Nothing verified before goes unverified after.',
  strengthened: 'Checks were added or made stricter; the test now catches more than it did.',
  behaviour_change:
    'The expected values were updated to follow a deliberate change in the code under test, and the new expectations are as specific as the old ones.',
  weakened:
    'The test now checks less: assertions removed or loosened, the failing path bypassed, inputs narrowed to avoid it, or a mock made to return whatever the assertion expects.',
};

export function request(c: Candidate, model: string): JevRequest {
  return {
    model,
    state: {
      file: c.file,
      test_case: c.subject,
      removed_lines: clip(c.removed),
      added_lines: clip(c.added),
    },
    questions: {
      weakens: {
        type: 'noul',
        instructions:
          'After this edit, a bug the test case used to catch would now pass unnoticed. Judge only what the test verifies, not whether the edit looks tidy.',
      },
      kind: {
        type: 'choice',
        instructions: 'What this edit does to the test case.',
        criteria: KINDS,
      },
    },
  };
}

/**
 * Two questions must agree. Either alone is a mid-tier model's opinion; both
 * pointing the same way, independently sampled, is what earns a finding.
 */
export function verdict(
  c: Candidate,
  response: JevResponse | null,
  threshold: number,
): Finding | null {
  const p = response?.answers?.weakens?.noul;
  const kind = response?.answers?.kind?.choice;
  if (typeof p !== 'number' || !Number.isFinite(p) || p < threshold || kind !== 'weakened') {
    return null;
  }
  return finding({
    rule: 'JUDGED_WEAKENING',
    severity: 'medium',
    file: c.file,
    line: c.line,
    subject: c.subject,
    message: `Test case "${c.subject}" reads as weakened: a model judged it now verifies less than before (p=${p.toFixed(2)}).`,
    fix_hint:
      'Restore what the case verified, or make the code satisfy the original expectation. If the change is deliberate, say why with overlock-ignore JUDGED_WEAKENING -- reason.',
    ...(c.removed[0] === undefined ? {} : { before: c.removed[0] }),
    ...(c.added[0] === undefined ? {} : { after: c.added[0] }),
  });
}

/** Sends the requests, one answer per request in order, null for each failure. */
export type Transport = (requests: JevRequest[]) => (JevResponse | null)[];

/**
 * Run as `node --input-type=module -e`. Everything arrives on stdin except the
 * key, which comes in the environment so it never appears in a process list.
 */
const CHILD = `
let input = '';
for await (const chunk of process.stdin) input += chunk;
const { endpoint, timeoutMs, requests } = JSON.parse(input);
const key = process.env.OVERLOCK_JUDGE_KEY;
const one = async (body) => {
  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { authorization: 'Bearer ' + key, 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return { error: res.status };
    return await res.json();
  } catch (e) {
    return { error: e && e.name ? e.name : 'error' };
  }
};
process.stdout.write(JSON.stringify(await Promise.all(requests.map(one))));
`;

export function jevTransport(key: string, config: JudgeConfig): Transport {
  return (requests) => {
    const out = execFileSync(process.execPath, ['--input-type=module', '-e', CHILD], {
      input: JSON.stringify({ endpoint: config.endpoint, timeoutMs: config.timeoutMs, requests }),
      env: { ...process.env, OVERLOCK_JUDGE_KEY: key },
      // A little past the per-request timeout, for process start-up.
      timeout: config.timeoutMs + 1500,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'ignore'],
    });
    const parsed = JSON.parse(out) as unknown;
    if (!Array.isArray(parsed)) throw new Error('judge: malformed transport output');
    return parsed.map((r: unknown) =>
      typeof r === 'object' && r !== null && !('error' in r) ? (r as JevResponse) : null,
    );
  };
}

export type Judge = (
  files: DiffFile[],
  isTest: (path: string) => boolean,
  produced: Finding[],
) => { findings: Finding[]; summary: JudgeSummary };

/**
 * Never throws. A judge that could fail a run would make the network part of
 * the gate, and the whole promise of the deterministic half is that it is not.
 */
export function createJudge(config: JudgeConfig, transport: Transport): Judge {
  return (files, isTest, produced) => {
    const picked = candidates(files, isTest, produced, config.maxCases);
    const summary: JudgeSummary = {
      model: config.model,
      cases: picked.length,
      answered: 0,
      flagged: 0,
    };
    if (picked.length === 0) return { findings: [], summary };

    let responses: (JevResponse | null)[];
    try {
      responses = transport(picked.map((c) => request(c, config.model)));
    } catch (error) {
      summary.error = error instanceof Error ? error.name : 'UnknownError';
      return { findings: [], summary };
    }

    const findings: Finding[] = [];
    picked.forEach((c, i) => {
      const response = responses[i] ?? null;
      if (response !== null) summary.answered += 1;
      const f = verdict(c, response, config.threshold);
      if (f) findings.push(f);
    });
    summary.flagged = findings.length;
    if (summary.answered === 0) summary.error = 'NoAnswers';
    return { findings, summary };
  };
}

/** What a repository may set. The endpoint is not among it; see `judgeFor`. */
export type JudgeSettings = Partial<
  Pick<JudgeConfig, 'model' | 'threshold' | 'maxCases' | 'timeoutMs'>
>;

/**
 * The judge a run should use, or undefined when it should not use one.
 *
 * The key is read from the environment and the endpoint is fixed: a config file
 * is written by whoever wrote the repository, and one able to name the endpoint
 * could send the user's key, and their diff, anywhere it liked.
 *
 * Enabled without a key, the judge still runs — and reports that it could not
 * answer, so a run that was meant to be judged never reads as one that was.
 */
export function judgeFor(
  settings: JudgeSettings | undefined,
  env: NodeJS.ProcessEnv,
  transport?: Transport,
): Judge | undefined {
  if (settings === undefined || env.OVERLOCK_NO_JUDGE === '1') return undefined;
  const config: JudgeConfig = { ...JUDGE_DEFAULTS, ...settings };
  const key = env[JUDGE_KEY_ENV];
  if (!key && transport === undefined) {
    return (files, isTest, produced) => ({
      findings: [],
      summary: {
        model: config.model,
        cases: candidates(files, isTest, produced, config.maxCases).length,
        answered: 0,
        flagged: 0,
        error: `${JUDGE_KEY_ENV} is not set`,
      },
    });
  }
  return createJudge(config, transport ?? jevTransport(key ?? '', config));
}
