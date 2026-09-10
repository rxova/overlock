---
title: Claude Code
description: A committed Stop hook that blocks the turn while a high finding stands.
sidebar:
  order: 1
---

```bash
npx overlock init claude
```

That writes a `Stop` hook into `.claude/settings.json` in the repository:

```json
{
  "hooks": {
    "Stop": [{ "hooks": [{ "type": "command", "command": "npx -y overlock hook claude" }] }]
  }
}
```

When the agent tries to end its turn, overlock runs. While a finding at or above the configured threshold stands, the turn is blocked and the findings are handed back to the model.

This is the integration the tool was built for. Everything else is a way of reading the same report.

## Why it blocks instead of advising

An instruction in a `CLAUDE.md` file is a suggestion the model may or may not act on, and it competes with every other instruction in the context for attention at the exact moment the model is trying to finish. A `Stop` hook is not in the context. It runs, and the turn does not end.

That difference matters most in the case this tool exists for: the model has just made the suite green by skipping a test, and is about to report success. At that moment the last thing you want is a document asking it politely to check.

## The file is committed on purpose

`init claude` writes the repository's `.claude/settings.json`, not `~/.claude/settings.json`.

Claude Code cloud sessions — the ones started from a phone — **do not read your home directory**. Hooks there come from the repository, from organisation-managed settings, or from a plugin. A tool installed into the home directory would work perfectly at your desk and do nothing in the one situation it was built for, silently.

Committing it also means collaborators inherit the hook without doing anything, which is the correct default for a gate.

If `.claude/settings.json` already exists, `init` adds to it rather than replacing it, and reports what it changed. If the file exists and is not valid JSON, it stops and says so rather than overwriting your settings.

## What the hook sees

At `Stop` time the patch covers **everything the agent committed since the session began, plus whatever it left in the working tree.**

Both halves are needed, because agents commonly commit before stopping. A hook that only read the working tree would find it empty after a commit and pass a session that skipped four tests. The `auto` base resolution handles this — see [how it reads a patch](../learn/how-it-reads-a-patch.md).

## The self-suppression stop

A suppression the patch itself added still silences the finding, and it also **stops the hook once**:

```
overlock: this patch silenced 1 of its own findings.

! src/auth.test.ts:42 TEST_SKIPPED_ADDED
   overlock-ignore ... -- flaky

If that is right, say so and finish. If not, fix the cause.
```

An agent writing its own permission slip is precisely the loop the gate exists to interrupt, so the claim gets quoted back at a human once. The hook never stops twice for the same directive, so the next turn continues either way. A directive that was already in the tree before this patch passes without comment.

## Tuning it

The hook reads [`overlock.config.json`](../reference/configuration.md), the same file the CLI and the [GitHub Action](github-action.md) read. So the threshold that blocks the agent, the base it resolves against, and any per-rule regrades are set once and agree everywhere:

```json
{
  "failOn": "high",
  "severity": { "TEST_REMOVED": "medium" }
}
```

A first week on an existing repository is often easier with `"failOn": "none"` — the agent is never blocked, every run is still reported and recorded in the [ledger](../reference/ledger.md), and you find out what your repository actually does before you gate on it.

## Also worth adding

`init` also prints the [MCP server](mcp.md) snippet. The hook is the gate; the MCP tool lets the agent ask overlock _while_ it is working, rather than finding out at the end. They are complementary, and the hook is the one that matters.
