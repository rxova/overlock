import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export type Agent = 'claude' | 'codex' | 'cursor' | 'copilot';

export const AGENTS: Agent[] = ['claude', 'codex', 'cursor', 'copilot'];

/** The command a hook or instruction file tells the agent to run. */
export const HOOK_COMMAND = 'npx -y patchfinder hook claude';

export interface InitResult {
  agent: Agent;
  /** Repo-relative paths this call created or edited. */
  written: string[];
  /** True when the configuration was already in place. */
  unchanged: boolean;
  notes: string[];
}

interface ClaudeHookGroup {
  hooks?: { type?: string; command?: string }[];
}

interface ClaudeSettings {
  hooks?: Record<string, unknown[]>;
  [key: string]: unknown;
}

/**
 * Writes the Stop hook into the repository's own `.claude/settings.json`.
 *
 * The path is the whole point and it is easy to get wrong: Claude Code cloud
 * sessions — the ones started from a phone — do not read `~/.claude/settings.json`.
 * Hooks there come from the repo, from organisation-managed settings, or from a
 * plugin. A tool installed into the home directory would work perfectly at a
 * desk and do nothing in the one situation it was built for, silently. So this
 * writes a committed file, and says so.
 */
export function initClaude(repoRoot: string): InitResult {
  const dir = join(repoRoot, '.claude');
  const file = join(dir, 'settings.json');

  let settings: ClaudeSettings = {};
  let existed = false;
  try {
    settings = JSON.parse(readFileSync(file, 'utf8')) as ClaudeSettings;
    existed = true;
  } catch {
    // No settings file yet, or it is not readable as JSON. Either way this call
    // creates one; a malformed existing file is reported rather than overwritten.
    try {
      readFileSync(file, 'utf8');
      throw new Error(`${file} exists but is not valid JSON — fix or remove it first.`);
    } catch (error) {
      if (error instanceof Error && error.message.includes('not valid JSON')) throw error;
    }
  }

  const hooks = (settings.hooks ??= {});
  const stop = (hooks.Stop ??= []) as ClaudeHookGroup[];

  const already = stop.some((group) =>
    (group.hooks ?? []).some(
      (h) => typeof h.command === 'string' && h.command.includes('patchfinder'),
    ),
  );

  if (already) {
    return {
      agent: 'claude',
      written: [],
      unchanged: true,
      notes: ['.claude/settings.json already runs patchfinder on Stop.'],
    };
  }

  stop.push({ hooks: [{ type: 'command', command: HOOK_COMMAND }] });

  mkdirSync(dir, { recursive: true });
  writeFileSync(file, `${JSON.stringify(settings, null, 2)}\n`, 'utf8');

  return {
    agent: 'claude',
    written: ['.claude/settings.json'],
    unchanged: false,
    notes: [
      existed ? 'Added a Stop hook to your existing settings.' : 'Created .claude/settings.json.',
      'Commit this file. Cloud and mobile sessions read hooks from the repo, never from ~/.claude.',
    ],
  };
}

/**
 * The other three agents have no blocking stop event, so the integration is an
 * instruction rather than a gate: the agent is told to run the check before it
 * reports done. Weaker, and honest about being weaker.
 */
export function instructionSnippet(): string {
  return [
    '## Before you finish',
    '',
    'Run `npx -y patchfinder check --compact` before reporting a task complete.',
    'If it reports any HIGH finding, fix the cause rather than the check, then run it again.',
    'It reads only the diff you just made; it takes about a second and makes no network calls.',
    '',
  ].join('\n');
}

const INSTRUCTION_FILES: Record<Exclude<Agent, 'claude'>, string> = {
  codex: 'AGENTS.md',
  cursor: '.cursor/rules/patchfinder.mdc',
  copilot: '.github/copilot-instructions.md',
};

export function initInstructions(repoRoot: string, agent: Exclude<Agent, 'claude'>): InitResult {
  const relative = INSTRUCTION_FILES[agent];
  const file = join(repoRoot, relative);
  const snippet = instructionSnippet();

  let existing = '';
  try {
    existing = readFileSync(file, 'utf8');
  } catch {
    // First write for this agent.
  }

  if (existing.includes('patchfinder check')) {
    return {
      agent,
      written: [],
      unchanged: true,
      notes: [`${relative} already mentions patchfinder.`],
    };
  }

  const separator = existing.length > 0 && !existing.endsWith('\n\n') ? '\n\n' : '';
  mkdirSync(join(file, '..'), { recursive: true });
  writeFileSync(file, `${existing}${separator}${snippet}`, 'utf8');

  return {
    agent,
    written: [relative],
    unchanged: false,
    notes: [
      `Appended the instruction to ${relative}.`,
      'This is an instruction, not a gate — the agent can forget it. Claude Code is the one that can be blocked.',
    ],
  };
}
