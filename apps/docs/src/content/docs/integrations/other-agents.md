---
title: Codex, Cursor and Copilot
description: An advisory instruction, and why it is weaker than the Claude Code hook.
sidebar:
  order: 2
---

```bash
npx overlock init codex
npx overlock init cursor
npx overlock init copilot
```

Each appends an instruction to the file that agent reads:

| Agent   | File                              |
| ------- | --------------------------------- |
| Codex   | `AGENTS.md`                       |
| Cursor  | `.cursor/rules/overlock.mdc`      |
| Copilot | `.github/copilot-instructions.md` |

The instruction is short and says what to run:

```md
## Before you finish

Run `npx -y overlock check --compact` before reporting a task complete.
If it reports any HIGH finding, fix the cause rather than the check, then run it again.
It reads only the diff you just made; it takes about a second and makes no network calls.
```

## This is weaker than the hook, and it is worth saying so

None of these agents has a blocking stop event. There is nowhere to attach a gate that runs when the model tries to finish, so the integration is an instruction: the agent is _asked_ to run the check.

That means it can be ignored. Not maliciously — an instruction file competes with the task, the codebase and everything else in the context, and the moment it matters most is the moment the model has the least attention to spare for it. Treat the instruction as raising the odds, not as a guarantee, and put the real gate in [CI](github-action.md) where it cannot be skipped.

The [Claude Code](claude-code.md) `Stop` hook is a genuine gate. If you are choosing an agent partly on how well you can constrain it, that difference is the reason.

## Making it stronger anyway

Two things help.

**Add the [MCP server](mcp.md).** All three of these agents can speak MCP. Instead of hoping the model runs a shell command, you give it a tool it can call, with a description that says what the tool is for. Models reach for tools far more readily than they follow prose instructions about shell commands.

**Put the real gate in CI.** The [GitHub Action](github-action.md) runs on the pull request regardless of which agent produced it, which editor it ran in, or whether anybody read the instruction file. That is the check that cannot be talked out of.

## Editing the instruction

`init` appends; it does not own the file. If your `AGENTS.md` already has a "Before you finish" section, merge the two by hand — a second heading with the same name is worse than one section that says both things.

Rewording it is fine. Keep two properties: the exact command, and the sentence about fixing the cause rather than the check. That second one is doing more work than it looks like, because "make overlock stop complaining" and "fix what overlock is complaining about" have very different shortest paths.
