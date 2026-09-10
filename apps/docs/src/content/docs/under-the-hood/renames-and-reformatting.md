---
title: Renames and reformatting
description: How a 607-file rename becomes one line instead of 293 true, useless findings.
sidebar:
  order: 1
---

A large rename makes every line it touches look edited. Run overlock on one and you get several hundred findings, each of them technically correct and collectively worthless:

```
overlock — 293 findings (293 low)  (origin/main)

  rename detected  warehouserouting -> routing  (607 files, 6 casings)
    293 findings consistent with it
    0 unexplained

293 findings the patch itself accounts for, not listed. `--json` has all of them.
```

overlock infers the substitution **from the patch itself** — nothing is configured, and no rename map is read from git — and then reports what the substitution does not account for.

The failure mode this avoids is not "the output is long". It is that a tool which produces 293 findings on a rename teaches you, correctly, that its output is not worth reading. Once that has happened it is not a gate any more.

## Casings count as one rename

Six casings in that example: `warehouserouting`, `warehouseRouting`, `WarehouseRouting`, `WAREHOUSE_ROUTING`, `warehouse-routing`, `warehouse_routing`. One decision, six textual substitutions, and a rename detector that treated them separately would find six weak signals instead of one strong one.

## One name becoming two

A name that became two names is read as one rename with two targets. Splitting one concept in two is a common refactor, and it should not read as a deletion plus an unexplained arrival.

Each target has to clear the recurrence bar **on its own**. Two targets is a refactor; a name that became more than two things is not a rename in any useful sense, and is treated as edited.

## What is left over is the point

Whatever the substitution does not explain is printed in full, and clustered by the name most of it mentions:

```
  22 of 25 unexplained findings mention cloud_sync
    Read that change once and most of this list goes with it.
```

This is the sentence the whole feature exists to produce. You have a 607-file patch, overlock has read all of it, and it is telling you that twenty-two of the twenty-five things worth looking at are one change. That is a five-minute review instead of an afternoon.

## Reformatting

The same machinery recognises pure reformatting. A file whose only delta is whitespace produces no findings at all.

And a shortened name that let a formatter re-join a wrapped import is still read as one substitution — which is the case that would otherwise be maddening, because the rename changed one identifier and the formatter changed the shape of forty lines around it.

## Inference never changes a verdict

This is the invariant to hold on to.

**An explained finding keeps its severity, still counts, and still fails the run if it was going to.** The inference only changes the order things are presented in, and whether a finding is printed in the list or summarised into a count.

A rename detector that suppressed findings would be a rule you could defeat by making your patch look like a rename, and "make the diff look mechanical" is not a bar worth setting. `explained_by` is present on the finding in the [JSON report](../reference/json-report.md), carrying the substitution — `"warehouserouting -> routing"`, or `"reformatting only"` — so a consumer can decide for itself what to do with that information. The gate does not decide for it.

## Collapsing repeats

Separately from rename inference, repeated findings are collapsed wherever they are printed: the same edit in twenty files is one row with a count.

That is presentation, and the [JSON report](../reference/json-report.md) always carries every finding individually.

## Where it touches other rules

Two rules lean on this directly:

- [`TEST_REMOVED`](../rules/test-removed.md) matches a deleted case by its title **with the patch's own rename applied**. `lists ledger entries` becoming `lists admin entries` is not a deletion if the patch renamed `ledger` to `admin`.
- [`TEST_AND_IMPL_TOGETHER`](../rules/test-and-impl-together.md) skips files whose delta is reformatting only, so a formatter run does not claim every test in the repository moved with its implementation.
