---
title: CLI reference
description: Every command and flag, with the exit codes a gate depends on.
sidebar:
  order: 1
---

```bash
overlock [check]                          # the current patch
overlock --staged                         # only what is staged
overlock --base main                      # against where this branch left main
overlock --base main --base-mode direct   # against main's tip itself
overlock --explain-base                   # say how the base was chosen, then run
overlock --fail-on-empty                  # exit 1 if the resolved patch is empty
overlock --json                           # the full report
overlock --compact                        # the short form
overlock --fail-on medium                 # high | medium | low | none
overlock --severity TEST_REMOVED=medium   # regrade one rule, repeatable
overlock --allow-file pr-body.txt         # read Overlock-Allow trailers from a file
overlock --test-glob '\.check\.ts$'       # extra test-file pattern, repeatable
overlock --limit 5                        # findings shown in --compact
overlock --cwd path/to/pkg                # run against another directory
overlock --no-untracked                   # ignore files git does not track yet
overlock --no-ledger                      # do not record this run
overlock --config <file>                  # read settings from this file
overlock --no-config                      # ignore overlock.config.json entirely
overlock config                           # the settings in force, and where from
overlock report [--days N]                # what the ledger has recorded
overlock init <agent>                     # claude | codex | cursor | copilot
overlock mcp                              # run as an MCP server on stdio
```

Requires Node.js 20.11 or newer.

## Exit codes

| Code | Meaning                          |
| ---- | -------------------------------- |
| `0`  | Nothing at or above `--fail-on`  |
| `1`  | Findings at or above `--fail-on` |
| `2`  | overlock could not run           |

`2` is the one worth wiring up separately. It means the tool failed — a bad `--base`, an unreadable config, a repository it cannot resolve — not that your patch is clean. A CI step that treats every non-zero code as "findings" will happily report a broken gate as a caught problem.

`overlock report` always exits `0`. It reports history and gates nothing.

## Choosing the patch

`--base auto` is the default and resolves in order: uncommitted work, then this branch's commits since it left the default branch, then the last commit.

`--base <ref>` is the **fork point** — `<ref>...HEAD` — not `git diff <ref>`. `--base-mode direct` asks for the literal comparison instead. [How it reads a patch](../learn/how-it-reads-a-patch.md) explains why the fork point is the default and when `direct` is right.

`--staged` reads the index only, and never includes untracked files.

`--explain-base` prints the resolution and then runs. Reach for it whenever a result surprises you.

`--fail-on-empty` turns an empty patch into exit 1, which is how you find out that a CI base is misconfigured instead of shipping a gate that passes everything forever.

## Choosing what fails

`--fail-on high | medium | low | none` moves the bar for the whole run. Default `high`.

`--severity <RULE>=<grade>` regrades one rule and leaves the rest alone. Repeatable. Use this instead of lowering `--fail-on` when one rule is noisy in your repository — see [severity](../learn/severity.md) for why that distinction is worth caring about.

An unrecognised `--fail-on` value fails closed at `high` rather than making every comparison false.

## Output

`--json` prints the full [report](json-report.md). This is the interface anything programmatic should read.

`--compact` prints the short form, bounded by `--limit` (default 5). It is what the [Stop hook](../integrations/claude-code.md) and the [MCP tool](../integrations/mcp.md) hand back to an agent, because the full human output is mostly formatting an agent does not need.

The default human output is the one you saw on the front page: a summary line, then each finding with its evidence and fix hint. Repeated findings are collapsed wherever they are printed — the same edit in twenty files is one row with a count.

## Sub-commands

**`overlock config`** prints the settings in force and where each one came from:

```
overlock: /repo/overlock.config.json
  base = "origin/main"  (config)
  baseMode = "fork-point"  (default)
  failOn = "low"  (flag)
```

Run this first when the hook and your terminal disagree. Nine times out of ten they are reading different config files.

**`overlock report [--days N]`** reads the [ledger](ledger.md) back. `--json` returns the aggregate as data.

**`overlock init <agent>`** — `claude`, `codex`, `cursor` or `copilot`. See [Claude Code](../integrations/claude-code.md) and [the other agents](../integrations/other-agents.md).

**`overlock mcp`** runs the [MCP server](../integrations/mcp.md) on stdio.

## Working directory and monorepos

`--cwd path/to/pkg` runs against another directory. The [config search](configuration.md) starts there, so a package carrying its own `overlock.config.json` gets its own settings.

## Suppressions from a file

`--allow-file pr-body.txt` reads `Overlock-Allow:` trailers from a file. This exists for CI, where the pull request body is available to the workflow but is not part of any commit message. See [suppressions](suppressions.md).
