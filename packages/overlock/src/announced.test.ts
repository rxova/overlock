import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { analyze } from './analyze.js';
import {
  announcedPath,
  patchClaims,
  readAnnounced,
  recordAnnounced,
  suppressionMemory,
} from './announced.js';
import { diffOf, hunk } from './__fixtures__/diffs.js';

const SCOPE = { repo: '/repo', branch: 'fix/input-upgrades' };

let dir: string | null = null;

afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = null;
});

function temp(): string {
  dir = mkdtempSync(join(tmpdir(), 'overlock-announced-'));
  return dir;
}

/** A patch that adds a skip and the directive that silences it. */
function silenced(reason: string, padding = 0): ReturnType<typeof analyze> {
  return analyze({
    diff: diffOf(
      'src/a.test.ts',
      hunk(
        [
          ...Array.from({ length: padding }, (_, i) => `+const unrelated${i} = ${i};`),
          `+  // overlock-ignore TEST_SKIPPED_ADDED -- ${reason}`,
          "+  it.skip('x', () => {})",
        ].join('\n'),
      ),
    ),
  });
}

describe('announcedPath', () => {
  it('prefers an explicit override', () => {
    expect(announcedPath({ OVERLOCK_ANNOUNCED: '/x/y.jsonl' })).toBe('/x/y.jsonl');
  });

  it('otherwise sits under the overlock home, beside the ledger', () => {
    expect(announcedPath({ OVERLOCK_HOME: '/home/me/.overlock' })).toBe(
      '/home/me/.overlock/announced.jsonl',
    );
  });

  it('falls back to the user home directory', () => {
    expect(announcedPath({})).toMatch(/\.overlock\/announced\.jsonl$/);
  });
});

describe('patchClaims', () => {
  it('is one key per directive the patch added', () => {
    const claims = patchClaims(silenced('quarantined pending #412'));
    expect(claims).toHaveLength(1);
    expect(claims[0]?.rule).toBe('TEST_SKIPPED_ADDED');
  });

  /**
   * The bug this whole store exists for, in miniature: a directive slides down
   * the file as the patch grows around it, and a key that moved with it would
   * be a new claim on every turn — which is a stop on every turn.
   */
  it('does not change when the directive moves down the file', () => {
    const [here] = patchClaims(silenced('flaky'));
    const [lower] = patchClaims(silenced('flaky', 4));
    expect(lower?.key).toBe(here?.key);
  });

  it('changes when the reason changes, so a new claim is put to the person', () => {
    const [first] = patchClaims(silenced('flaky'));
    const [second] = patchClaims(silenced('quarantined pending #412'));
    expect(second?.key).not.toBe(first?.key);
  });

  it('covers a trailer the patch wrote about itself', () => {
    const report = analyze({
      diff: diffOf('src/a.test.ts', hunk("+  it.skip('x', () => {})")),
      allowText: 'Overlock-Allow: TEST_SKIPPED_ADDED src/a.test.ts -- quarantined pending #412',
    });

    const claims = patchClaims(report);
    expect(claims).toHaveLength(1);
    expect(claims[0]?.rule).toBe('TEST_SKIPPED_ADDED');
  });

  it('tells a trailer apart from a directive that says the same thing', () => {
    const inline = patchClaims(silenced('flaky'))[0];
    const trailer = patchClaims(
      analyze({
        diff: diffOf('src/a.test.ts', hunk("+  it.skip('x', () => {})")),
        allowText: 'Overlock-Allow: TEST_SKIPPED_ADDED -- flaky',
      }),
    )[0];

    expect(trailer?.key).not.toBe(inline?.key);
  });

  it('records no source, only a hash of the claim', () => {
    expect(JSON.stringify(patchClaims(silenced('quarantined pending #412')))).not.toContain(
      'quarantined',
    );
  });
});

describe('recordAnnounced and readAnnounced', () => {
  it('remembers a claim across processes', () => {
    const path = join(temp(), 'nested', 'announced.jsonl');
    const claims = patchClaims(silenced('flaky'));

    expect(recordAnnounced(claims, SCOPE, path)).toBe(true);
    expect(readAnnounced(path, SCOPE).has(claims[0]?.key as string)).toBe(true);
  });

  it('writes one JSON object per line', () => {
    const path = join(temp(), 'announced.jsonl');
    const claims = patchClaims(silenced('flaky'));
    recordAnnounced(claims, SCOPE, path);
    recordAnnounced(claims, SCOPE, path);

    const lines = readFileSync(path, 'utf8').trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0] as string)).toMatchObject({
      branch: 'fix/input-upgrades',
      rule: 'TEST_SKIPPED_ADDED',
    });
  });

  it('writes nothing when there is nothing to remember', () => {
    const path = join(temp(), 'announced.jsonl');
    expect(recordAnnounced([], SCOPE, path)).toBe(true);
    expect(() => readFileSync(path, 'utf8')).toThrow();
  });

  /** Another branch's answer is not this branch's; the claim is put again. */
  it('is scoped to one repository and branch', () => {
    const path = join(temp(), 'announced.jsonl');
    const claims = patchClaims(silenced('flaky'));
    recordAnnounced(claims, SCOPE, path);

    expect(readAnnounced(path, { ...SCOPE, branch: 'other' }).size).toBe(0);
    expect(readAnnounced(path, { ...SCOPE, repo: '/elsewhere' }).size).toBe(0);
  });

  it('reads nothing at all when there is no file yet', () => {
    expect(readAnnounced(join(temp(), 'missing.jsonl'), SCOPE).size).toBe(0);
  });

  it('skips a malformed or half-written line rather than losing the rest', () => {
    const path = join(temp(), 'announced.jsonl');
    const claims = patchClaims(silenced('flaky'));
    recordAnnounced(claims, SCOPE, path);
    writeFileSync(
      path,
      `not json\n${readFileSync(path, 'utf8')}\n{"repo":"/repo"}\n{"ts":"x"`,
      'utf8',
    );

    expect(readAnnounced(path, SCOPE).size).toBe(1);
  });

  it('reports failure instead of throwing — a stop must never fail on a write', () => {
    const blocker = join(temp(), 'blocker');
    writeFileSync(blocker, 'not a directory');

    expect(recordAnnounced(patchClaims(silenced('flaky')), SCOPE, join(blocker, 'a.jsonl'))).toBe(
      false,
    );
  });
});

describe('suppressionMemory', () => {
  it('reads what was recorded and records what it is given', () => {
    const path = join(temp(), 'announced.jsonl');
    const warnings: string[] = [];
    const claims = patchClaims(silenced('flaky'));

    const first = suppressionMemory({
      scope: SCOPE,
      env: { OVERLOCK_ANNOUNCED: path },
      warn: (m) => warnings.push(m),
    });
    expect(first.seen.size).toBe(0);
    first.remember(claims);

    const second = suppressionMemory({
      scope: SCOPE,
      env: { OVERLOCK_ANNOUNCED: path },
      warn: (m) => warnings.push(m),
    });
    expect(second.seen.has(claims[0]?.key as string)).toBe(true);
    expect(warnings).toEqual([]);
  });

  it('says so when the notice could not be recorded, because it will repeat', () => {
    const blocker = join(temp(), 'blocker');
    writeFileSync(blocker, 'not a directory');
    const warnings: string[] = [];

    suppressionMemory({
      scope: SCOPE,
      env: { OVERLOCK_ANNOUNCED: join(blocker, 'a.jsonl') },
      warn: (m) => warnings.push(m),
    }).remember(patchClaims(silenced('flaky')));

    expect(warnings[0]).toContain('could not be recorded');
  });
});
