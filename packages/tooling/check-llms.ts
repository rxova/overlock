/**
 * Keeps llms.txt honest.
 *
 * It is the file an agent reads to decide how to use this tool, so a rule ID
 * that no longer exists or a command that was renamed is worse than no file at
 * all — it is confidently wrong, to a reader with no way to check.
 */
import { readFileSync } from 'node:fs';
import { RULE_IDS } from '../overlock/src/types.js';

const text = readFileSync(new URL('../overlock/llms.txt', import.meta.url), 'utf8');
const problems: string[] = [];

for (const rule of RULE_IDS) {
  if (!text.includes(rule)) problems.push(`rule ${rule} is missing from llms.txt`);
}

// Anything that looks like a rule ID but is not one: a stale name left behind
// by a rename reads exactly like a real instruction.
for (const candidate of new Set(text.match(/\b[A-Z][A-Z_]{6,}\b/g) ?? [])) {
  if (!(RULE_IDS as readonly string[]).includes(candidate)) {
    problems.push(`llms.txt names ${candidate}, which is not a rule ID`);
  }
}

for (const command of [
  'overlock check',
  'overlock hook claude',
  'overlock init',
  'overlock report',
  'overlock mcp',
]) {
  if (!text.includes(command)) problems.push(`command "${command}" is missing from llms.txt`);
}

if (problems.length > 0) {
  console.error(
    `check-llms: ${problems.length} problem(s)\n${problems.map((p) => `  - ${p}`).join('\n')}`,
  );
  process.exit(1);
}

console.log(`check-llms: llms.txt covers all ${RULE_IDS.length} rules and every command`);
