---
title: SNAPSHOT_UPDATED_WITH_CODE
description: A snapshot was regenerated in the same patch as the code it snapshots.
sidebar:
  order: 12
---

**Severity: `medium`.**

```
!  MED  src/__snapshots__/invoice.test.ts.snap:1  SNAPSHOT_UPDATED_WITH_CODE
     Snapshot updated alongside 3 changed source files.
     -> Read the snapshot diff itself — it is the assertion, and it was rewritten.
```

A snapshot is an assertion whose expected value is a file. `-u` rewrites the expected value to whatever the code produced, which is a legitimate workflow and also a machine that turns any regression into a passing test.

When the snapshot and the code it covers change in the same patch, the snapshot has stopped being evidence about that patch. It agrees with the code by construction.

## Why it is only `medium`

Because this is how snapshot testing works. Change the component, update the snapshot, review the diff — that is the intended loop, and most of the time the person did review the diff.

The rule is not claiming otherwise. It exists so that the snapshot shows up **next to the other findings**, in the same list, at the moment you are already reading. The finding you actually want is the one where the summary reads: a snapshot regenerated, an assertion weakened two files over, and a coverage threshold that moved.

## The hint is an instruction, not a warning

> Read the snapshot diff itself — it is the assertion, and it was rewritten.

Snapshot diffs are the least-read part of any pull request. They are long, they are mechanical-looking, and a reviewer who has already read the component change reasonably assumes the snapshot follows from it. That assumption is correct right up until the moment it is not, and the snapshot is the only place the regression is written down.

## What counts as a snapshot

`.snap` files, anything under a `__snapshots__/` directory, and `.ambr` (syrupy, for Python).

"The code it snapshots" is any non-test source file changed in the same patch — the message says how many. overlock does not try to work out which component a given snapshot belongs to; a diff does not carry that, and guessing would produce a rule that is wrong in a way you cannot check.

## Suppressing it

```
Overlock-Allow: SNAPSHOT_UPDATED_WITH_CODE -- design system token rename; every snapshot moved
```

A trailer suits this rule better than an inline directive, because the finding sits on line 1 of a generated file and nobody should be hand-editing those.
