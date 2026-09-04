import { execFileSync } from 'node:child_process';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RULE_IDS } from '../overlock/src/types.js';
import { COMMANDS, findProblems, main, readLlmsTxt } from './check-llms.js';

/** A file that satisfies every rule this checker has. */
const goodEnough = (): string => [...RULE_IDS, ...COMMANDS].join('\n');

describe('findProblems', () => {
  it('is quiet about a file that covers everything', () => {
    expect(findProblems(goodEnough())).toEqual([]);
  });

  it('names a rule the file forgot', () => {
    const text = goodEnough().replace(`${RULE_IDS[0]}\n`, '');
    expect(findProblems(text)).toEqual([`rule ${RULE_IDS[0]} is missing from llms.txt`]);
  });

  it('names a rule-shaped word that is not a rule', () => {
    const problems = findProblems(`${goodEnough()}\nCOVERAGE_LOWERED`);
    expect(problems).toEqual(['llms.txt names COVERAGE_LOWERED, which is not a rule ID']);
  });

  it('complains about a stale name once, however often it appears', () => {
    const problems = findProblems(`${goodEnough()}\nSTALE_RULE_NAME\nSTALE_RULE_NAME`);
    expect(problems).toHaveLength(1);
  });

  it('ignores words too short to look like a rule ID', () => {
    expect(findProblems(`${goodEnough()}\nMIT API CLI JSON`)).toEqual([]);
  });

  it('names a command the file forgot', () => {
    const text = goodEnough().replace('overlock mcp', '');
    expect(findProblems(text)).toEqual(['command "overlock mcp" is missing from llms.txt']);
  });

  it('takes the rules and commands it is given', () => {
    expect(findProblems('ALPHA_RULE and a command', ['ALPHA_RULE'], ['a command'])).toEqual([]);
    expect(findProblems('', ['ALPHA_RULE'], [])).toEqual([
      'rule ALPHA_RULE is missing from llms.txt',
    ]);
  });
});

describe('readLlmsTxt', () => {
  it('reads the file that ships with the package', () => {
    expect(readLlmsTxt()).toContain('overlock check');
  });
});

describe('main', () => {
  const log = vi.spyOn(console, 'log').mockImplementation(() => {});
  const error = vi.spyOn(console, 'error').mockImplementation(() => {});
  afterEach(() => {
    log.mockClear();
    error.mockClear();
  });

  it('passes on the real llms.txt', () => {
    expect(main()).toBe(0);
    expect(log).toHaveBeenCalledWith(
      `check-llms: llms.txt covers all ${RULE_IDS.length} rules and every command`,
    );
  });

  it('fails, counting the problems and listing them', () => {
    expect(main({ read: () => 'nothing useful' })).toBe(1);
    const message = error.mock.calls[0]?.[0] as string;
    expect(message).toContain(`check-llms: ${RULE_IDS.length + COMMANDS.length} problem(s)`);
    expect(message).toContain(`  - rule ${RULE_IDS[0]} is missing`);
  });
});

describe('the entry point', () => {
  it('runs the script against the real file', () => {
    const script = new URL('./check-llms.ts', import.meta.url).pathname;
    const out = execFileSync(process.execPath, ['--import', 'tsx', script], { encoding: 'utf8' });
    expect(out).toContain('check-llms: llms.txt covers all');
  });
});
