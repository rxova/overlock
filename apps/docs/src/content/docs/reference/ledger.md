---
title: The ledger
description: One line per run in ~/.overlock/ledger.jsonl, and what overlock report makes of it.
sidebar:
  order: 6
---

Every run appends one line to `~/.overlock/ledger.jsonl`: timestamp, repository, branch, which rules fired, and whether the run failed.

It records **rule, severity and location only — never file contents.** The evidence lines in a finding are source code, and a durable file in your home directory quietly accumulating fragments of every repository you work on is not a thing anyone asked for.

Nothing is uploaded. There is no network code in this package at all.

## `overlock report`

```console
$ overlock report
overlock — 30 days, 3 repos, 60 runs

  Caught           10   runs with a high or medium finding
  Blocked           5   times an agent was stopped
  Suppressed        5   findings silenced with a reason
  Noted             3   runs with low findings only

By rule
  ASSERTION_WEAKENED             5  ████████████████████████
  COVERAGE_THRESHOLD_LOWERED     2  ██████████
  TEST_SKIPPED_ADDED             2  ██████████

Context only
  TEST_AND_IMPL_TOGETHER         6
```

`--days <n>` moves the window. `--json` returns the aggregate as data. `report` always exits `0` — it reports history and gates nothing.

## Why `low` is counted separately

"Caught" counts `high` and `medium` only.

[`TEST_AND_IMPL_TOGETHER`](../rules/test-and-impl-together.md) fires on ordinary test-driven work — every time you change a module and its test in the same commit. Counting it as a catch would produce an impressive number that means nothing, and the first person to notice would stop believing the other numbers too.

So `low` findings go under "Noted", and "Context only" lists them by rule. The headline number is the one you can act on.

## What the numbers are for

The per-run verdict tells you about a patch. The ledger tells you about a habit.

"Blocked 5" over a month means an agent tried to finish with a `high` finding standing five times, and did not. "Suppressed 5" means five findings were decided to be fine — and if that number is climbing while "Caught" stays flat, the suppressions have become the workflow, which is worth knowing before it is a year old.

The rule breakdown is the other useful shape. A repository where `COVERAGE_THRESHOLD_LOWERED` shows up every week does not have a coverage problem; it has a threshold nobody believes in.

## Turning it off and moving it

`--no-ledger` skips recording for a run. `"noLedger"` is not a config key — this is a per-run decision, and a repository that turns off its own history for everyone who checks it out is a strange default to ship.

Two environment variables move the file:

- **`OVERLOCK_LEDGER`** — the full path to the ledger file itself.
- **`OVERLOCK_HOME`** — the directory it lives in, replacing `~/.overlock`. The ledger is then `$OVERLOCK_HOME/ledger.jsonl`.

`OVERLOCK_LEDGER` wins when both are set. `OVERLOCK_HOME` is the one to use in a test or a sandbox, where you want the whole directory somewhere disposable.

## Not in CI

The [GitHub Action](../integrations/github-action.md) never writes a ledger. The file records what agents did on a developer's machine; a fresh runner has no history to add to and nothing to carry it forward, so all it would produce is one orphaned line per job.

## The format

JSON Lines — one JSON object per line, appended. Readable with `jq`, tail-able, and safe to truncate. `readLedger` and `summarize` are [exported](api.md) if you would rather compute your own aggregate.
