import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HOOK_COMMAND, initClaude, initInstructions, instructionSnippet } from './init.js';

let dir: string | null = null;

function makeDir(): string {
  dir = mkdtempSync(join(tmpdir(), 'patchfinder-init-'));
  return dir;
}

afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = null;
});

function settings(root: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(root, '.claude', 'settings.json'), 'utf8')) as Record<
    string,
    unknown
  >;
}

describe('initClaude', () => {
  it('creates a committed .claude/settings.json with a Stop hook', () => {
    const root = makeDir();
    const result = initClaude(root);

    expect(result.written).toEqual(['.claude/settings.json']);
    expect(result.notes.join(' ')).toContain('Commit this file');

    const parsed = settings(root) as { hooks: { Stop: { hooks: { command: string }[] }[] } };
    expect(parsed.hooks.Stop[0]?.hooks[0]?.command).toBe(HOOK_COMMAND);
  });

  it('preserves settings and hooks that are already there', () => {
    const root = makeDir();
    mkdirSync(join(root, '.claude'), { recursive: true });
    writeFileSync(
      join(root, '.claude', 'settings.json'),
      JSON.stringify({
        permissions: { allow: ['Bash(pnpm test)'] },
        hooks: { Stop: [{ hooks: [{ type: 'command', command: 'echo existing' }] }] },
      }),
    );

    initClaude(root);

    const parsed = settings(root) as {
      permissions: unknown;
      hooks: { Stop: { hooks: { command: string }[] }[] };
    };
    expect(parsed.permissions).toEqual({ allow: ['Bash(pnpm test)'] });
    expect(parsed.hooks.Stop).toHaveLength(2);
    expect(parsed.hooks.Stop[0]?.hooks[0]?.command).toBe('echo existing');
  });

  it('is idempotent', () => {
    const root = makeDir();
    initClaude(root);
    const second = initClaude(root);

    expect(second.unchanged).toBe(true);
    expect(second.written).toEqual([]);

    const parsed = settings(root) as { hooks: { Stop: unknown[] } };
    expect(parsed.hooks.Stop).toHaveLength(1);
  });

  it('refuses to overwrite a settings file it cannot parse', () => {
    const root = makeDir();
    mkdirSync(join(root, '.claude'), { recursive: true });
    writeFileSync(join(root, '.claude', 'settings.json'), '{ not json');

    expect(() => initClaude(root)).toThrow(/not valid JSON/);
  });
});

describe('initInstructions', () => {
  it('appends the instruction to AGENTS.md for codex', () => {
    const root = makeDir();
    const result = initInstructions(root, 'codex');

    expect(result.written).toEqual(['AGENTS.md']);
    expect(readFileSync(join(root, 'AGENTS.md'), 'utf8')).toContain('patchfinder check');
    expect(result.notes.join(' ')).toContain('not a gate');
  });

  it('keeps existing content', () => {
    const root = makeDir();
    writeFileSync(join(root, 'AGENTS.md'), '# House rules\n');
    initInstructions(root, 'codex');

    const text = readFileSync(join(root, 'AGENTS.md'), 'utf8');
    expect(text).toContain('# House rules');
    expect(text).toContain('patchfinder check');
  });

  it('is idempotent', () => {
    const root = makeDir();
    initInstructions(root, 'cursor');
    expect(initInstructions(root, 'cursor').unchanged).toBe(true);
  });

  it('writes where each agent looks', () => {
    const root = makeDir();
    expect(initInstructions(root, 'cursor').written).toEqual(['.cursor/rules/patchfinder.mdc']);
    expect(initInstructions(root, 'copilot').written).toEqual(['.github/copilot-instructions.md']);
  });
});

describe('instructionSnippet', () => {
  it('tells the agent to fix the cause rather than the check', () => {
    expect(instructionSnippet()).toContain('fix the cause rather than the check');
  });
});
