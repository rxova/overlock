---
title: TEST_AND_IMPL_TOGETHER
description: A test changed alongside the implementation it is named after. Context, not an accusation.
sidebar:
  order: 12
---

**Severity: `low`.**

```
·  LOW  src/invoice.test.ts:1  TEST_AND_IMPL_TOGETHER
     Changed in the same patch as src/invoice.ts.
     -> Normal for TDD. Worth a glance if anything else here is flagged.
```

This fires on ordinary test-driven work. You changed `invoice.ts` and `invoice.test.ts` in the same commit, which is exactly what you are supposed to do.

So read the hint literally: **normal for TDD.** This rule is not telling you that you did something wrong. It is telling you which implementation change the rest of the findings are about.

## What it is for

An overlock run on a forty-file patch prints findings scattered across a dozen test files. The question a reviewer then has is _which change caused these_, and the answer is usually one implementation file that several of the flagged tests are named after.

`TEST_AND_IMPL_TOGETHER` is that link, made explicit. Read on its own it is noise. Read next to an [`ASSERTION_WEAKENED`](assertion-weakened.md) in the same file, it says: this assertion got looser in the same patch that changed the code it was checking.

## Why it does not fail runs

It would fail almost every patch that touches a test, which is almost every patch. A gate that fires constantly is a gate people learn to click past, and then it is not protecting the rules that matter either.

It is also excluded from "catches" in the [ledger](../reference/ledger.md) for the same reason — it would dominate every total and make the numbers meaningless. It is counted under "Context only".

## Reformat-only files are skipped

A file whose entire delta is whitespace does not count as having changed for this rule. A formatter run that touched four hundred files should not produce four hundred findings claiming every test in the repository moved with its implementation. See [renames and reformatting](../under-the-hood/renames-and-reformatting.md).

## If you want it out of the way

`--fail-on` already ignores it. To drop it out of the printed output entirely, raise the reporting floor:

```bash
overlock --fail-on high --limit 10
```

`--limit` bounds what `--compact` shows. The full set is always in [`--json`](../reference/json-report.md), which is where anything programmatic should be reading from anyway.
