/**
 * Keeps llms.txt honest.
 *
 * It is the file an agent reads to decide how to use this tool, so a rule ID
 * that no longer exists or a command that was renamed is worse than no file at
 * all — it is confidently wrong, to a reader with no way to check.
 */
import { readFileSync } from 'node:fs';
import { RULE_IDS } from '../overlock/src/types.js';
import { isEntry } from './entry.js';

/** Every command the file is required to document. */
export const COMMANDS = [
  'overlock check',
  'overlock hook claude',
  'overlock init',
  'overlock report',
  'overlock mcp',
] as const;

/** Anything that looks like a rule ID: SCREAMING_SNAKE, seven characters up. */
const RULE_SHAPED = /\b[A-Z][A-Z_]{6,}\b/g;

export const findProblems = (
  text: string,
  ruleIds: readonly string[] = RULE_IDS,
  commands: readonly string[] = COMMANDS,
): string[] => {
  const problems: string[] = [];

  for (const rule of ruleIds) {
    if (!text.includes(rule)) problems.push(`rule ${rule} is missing from llms.txt`);
  }

  // Anything that looks like a rule ID but is not one: a stale name left behind
  // by a rename reads exactly like a real instruction.
  for (const candidate of new Set(text.match(RULE_SHAPED) ?? [])) {
    if (!ruleIds.includes(candidate)) {
      problems.push(`llms.txt names ${candidate}, which is not a rule ID`);
    }
  }

  for (const command of commands) {
    if (!text.includes(command)) problems.push(`command "${command}" is missing from llms.txt`);
  }

  return problems;
};

export const readLlmsTxt = (): string =>
  readFileSync(new URL('../overlock/llms.txt', import.meta.url), 'utf8');

/** Returns the process exit code rather than taking it, so tests can call it. */
export const main = ({ read = readLlmsTxt }: { read?: () => string } = {}): number => {
  const problems = findProblems(read());

  if (problems.length > 0) {
    console.error(
      `check-llms: ${problems.length} problem(s)\n${problems.map((p) => `  - ${p}`).join('\n')}`,
    );
    return 1;
  }

  console.log(`check-llms: llms.txt covers all ${RULE_IDS.length} rules and every command`);
  return 0;
};

/* v8 ignore start -- the entry shell; covered by the test that spawns this
   file, which reports no coverage back into this run. */
if (isEntry(import.meta.url)) {
  process.exit(main());
}
/* v8 ignore stop */
