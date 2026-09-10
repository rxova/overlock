---
title: GitHub Action
description: The gate that runs on the pull request, and posts one comment it keeps editing.
sidebar:
  order: 4
---

```yaml
permissions:
  contents: read
  pull-requests: write

steps:
  - uses: actions/checkout@v5
    with: { fetch-depth: 0 }
  - uses: rxova/overlock@v0
```

`fetch-depth: 0` is not optional. overlock compares against a base commit, and a shallow checkout does not have one.

This is the check that cannot be talked out of. Whatever produced the branch — an agent with a hook, an agent without one, a person in a hurry — the pull request runs through the same rules.

## It diffs against the base commit, not `github.sha`

On a pull request, `github.sha` is the _merge_ commit that GitHub synthesised. Diffing against it reports approximately nothing, because the merge commit already contains the branch. This is a common way to end up with a green gate that has never once run.

The action resolves the real base commit instead. You do not have to configure it.

## One comment, edited in place

The action posts a single findings comment and edits it on later pushes, rather than adding one per run. A gate that appends to the thread every time somebody pushes gets muted within a day.

The comment leads with what fails the run, and with the inferred [rename](../under-the-hood/renames-and-reformatting.md) when there is one. Everything else is grouped by rule inside a `<details>` block, so a clean-ish run is one line in the timeline and a bad one opens to the full list.

## Inputs and outputs

**Inputs:** `base`, `fail-on`, `severity`, `comment`, `working-directory`, `version`, `cli-path`, `github-token`.

**Outputs:** `ok`, `findings`, `report`, `fail-on`.

`report` is the full [JSON report](../reference/json-report.md), so a later step can do something with it — post to somewhere else, fail a different way, feed a dashboard.

```yaml
- uses: rxova/overlock@v0
  id: overlock
  with:
    fail-on: medium
    severity: TEST_REMOVED=medium
- if: steps.overlock.outputs.ok == 'false'
  run: echo "${{ steps.overlock.outputs.findings }} findings"
```

Set `comment: false` when the repository already has enough bots in the thread; the run still passes or fails.

## Config file over inputs

The action reads [`overlock.config.json`](../reference/configuration.md), the same file the CLI and the [Stop hook](claude-code.md) read.

Prefer the file. Settings expressed as workflow inputs live somewhere the agent working on the repository never looks, which is how a hook that passes locally and a CI job that fails start disagreeing about the same patch. One committed file, three consumers, no drift.

## Pin the version for the cache

The CLI is installed once per job and then invoked as a local file. The analysis itself takes seconds — most of a slow run is npm.

```yaml
- uses: rxova/overlock@v0
  with:
    version: 0.8.1
```

Pinning `version` to an exact release lets the runner's npm cache hit. `latest` has to resolve against the registry on every run, which is most of the difference between a fast job and a slow one.

## No ledger in CI

The action never writes a [ledger](../reference/ledger.md). That file records what agents did on a developer's machine, and a fresh runner has no history to add to and nothing to carry it forward.
