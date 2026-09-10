---
title: MCP server
description: overlock as an MCP stdio server, with two tools an agent can call mid-task.
sidebar:
  order: 3
---

```json
{
  "mcpServers": {
    "overlock": { "command": "npx", "args": ["-y", "overlock", "mcp"] }
  }
}
```

`overlock mcp` runs the tool as an MCP server on stdio. `overlock init <agent>` prints this snippet for you.

## Two tools

**`overlock_check`** runs the analysis on the current patch. It returns the compact report, and the full JSON **only when there is something to act on** — a clean run costs one line rather than a serialised empty report. That is a deliberate token decision: an agent calling this tool several times during a task should pay almost nothing for the calls where nothing is wrong.

**`overlock_report`** reads the [ledger](../reference/ledger.md) back — what has been caught, on which repositories, over the last N days. Useful when the question is about the pattern rather than the patch.

## What it is good for, and what it is not

The MCP tool lets the agent ask _during_ the work: it has just rewritten a test file, and it can check whether what it did asks less than what was there. That is a better place to find out than at the end.

It is not a gate. The agent chooses when to call the tool, which means the agent can choose not to. For [Claude Code](claude-code.md), the `Stop` hook is the gate and the MCP tool is the convenience — add both, and do not let the second one talk you out of the first.

For [Codex, Cursor and Copilot](other-agents.md), which have no blocking hook, MCP is the strongest in-editor integration available. Models reach for a described tool much more readily than they follow a prose instruction to run a shell command, so it is a real improvement over the instruction file alone — just not a guarantee.

## No SDK

The server implements MCP over stdio directly rather than through `@modelcontextprotocol/sdk`.

The reason is the dependency count. overlock ships with zero runtime dependencies, which is what makes `npx overlock` on a cold cache a single small download, and that property is worth more here than the convenience of an SDK — this is a tool that agents invoke constantly, from cold caches, in CI containers.

Protocol version strings are taken from the official SDK's constants rather than being invented, and negotiation echoes the client's version when it is one overlock recognises. The current protocol version is `2025-11-25`.

## Trust boundary

Everything overlock quotes back — evidence lines, test names, file paths — was written by whoever wrote the patch, and it is arriving in an agent's context. Evidence is labelled as quoted content wherever it reaches an agent, and control characters are stripped from messages, evidence and paths.

The `base` argument is reachable from the MCP tool call, and a `--base` value beginning with a dash is refused, because `git diff --output=FILE` writes wherever it is pointed. [Untrusted input](../under-the-hood/untrusted-input.md) is the full list.
