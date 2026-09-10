---
title: Programmatic use
description: analyze() takes a unified diff and returns the report the CLI serialises.
sidebar:
  order: 5
---

```ts
import { analyze } from 'overlock';

const report = analyze({ diff: myUnifiedDiff, failOn: 'medium' });
```

`analyze` takes a unified diff and returns the same [report](json-report.md) the CLI prints with `--json`. It is pure: no git, no filesystem, no network. You hand it text, it hands you findings.

That shape is deliberate. The part of overlock that talks to git is separate from the part that reads a patch, so anything that can produce a unified diff — a webhook payload, a review tool, a test fixture — can use the rules without a repository on disk.

## Options

```ts
interface AnalyzeOptions {
  /** Raw `git diff` text. */
  diff: string;
  /** The resolved range, echoed into the report so a log says what was checked. */
  base?: string;
  /** Extra patterns that mark a path as a test file. */
  testGlobs?: RegExp[];
  /** Severity at or above which the report is not ok. Default 'high'. */
  failOn?: Severity | 'none';
  /** Per-rule grade, replacing the built-in one for those rules. */
  severities?: Partial<Record<RuleId, Grade>>;
  /** Commit messages and PR body, searched for `Overlock-Allow:` trailers. */
  allowText?: string;
}
```

`testGlobs` takes real `RegExp` objects here, not the strings the [config file](configuration.md) uses.

`severities` is `Grade`, not `Severity`: `'high' | 'medium' | 'low' | 'off'`. A rule set to `off` produces no findings and what it dropped is counted in the report's `silenced`. Note that `Grade` is not currently exported from the package, so a TypeScript consumer has to spell the union out; `Severity` is exported and does not include `'off'`, because `off` is something a rule can be set to and not something a finding can carry.

`allowText` is where commit messages and a pull request body go, so [trailers](suppressions.md) apply. Leave it empty for uncommitted work, which has no message to read.

## Rule IDs

```ts
import { RULE_IDS } from 'overlock';
```

The thirteen IDs, in report order. Enumerate them from here rather than hardcoding the list — adding a rule is a minor release, and a hardcoded array silently stops covering the new one.

Types come with them: `Severity`, `RuleId`, `Finding`, `Report`, `Evidence`, `DiffFile`, `DiffLine`, `Hunk`.

## The rest of the surface

The package exports more than `analyze`, because the CLI is built out of it and the pieces are useful separately:

- **`parseDiff`, `addedLines`, `removedLines`** — the diff parser.
- **`resolveRange`, `explainRange`, `rangeScope`, `untrackedDiff`, `assertSafeRef`** — base resolution, the logic behind `--base` and `--explain-base`.
- **`loadConfig`, `parseConfig`, `CONFIG_FILE`, `ConfigError`** — the [config file](configuration.md), including the search.
- **`human`, `compact`, `json`, `summaryText`, `describeScope`, `isEmptyPatch`** — the report formatters.
- **`collectSuppressions`, `applySuppressions`** — [suppressions](suppressions.md).
- **`isTestFile`, `isSnapshotFile`, `isThresholdConfig`** — the path conventions.
- **`readLedger`, `summarize`, `ledgerPath`, `appendLedger`** — the [ledger](ledger.md).
- **`RULES`** — the rule implementations themselves.
- **`stopHookOutcome`, `parseStopPayload`, `sessionBase`** — the [Stop hook](../integrations/claude-code.md).
- **`handleMessage`, `TOOLS`, `LATEST_PROTOCOL_VERSION`** — the [MCP server](../integrations/mcp.md).

Only `analyze`, `RULE_IDS` and the types are the stable contract in the sense the [schema](json-report.md) is. The rest is exported because it is genuinely useful and hiding it would only mean people vendored it, but treat it as a version-to-version surface.

## ESM, and no dependencies

The package is ESM with generated `.d.ts`, targeting Node.js 20.11 or newer, and it has zero runtime dependencies. Importing `overlock` into a build tool adds nothing to your tree.
