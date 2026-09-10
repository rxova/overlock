---
title: TEST_REMOVED
description: A test file was deleted or renamed out of the glob, or a case vanished from a file that survived.
sidebar:
  order: 2
---

**Severity: `high`, or `medium` when the patch accounts for it.**

The most direct way to make a test stop failing is to make it stop existing. `TEST_REMOVED` covers the three shapes of that: a deleted test file, a test file renamed out of the runner's glob, and a case that disappeared from a file that is still there.

```diff
-  it('rejects expired tokens', async () => {
-    await expect(verify(expired)).rejects.toThrow('expired');
-  });
```

```
✗ HIGH  src/auth.test.ts:42  TEST_REMOVED
     Test case removed: rejects expired tokens
     -> Put the case back, or replace it with one that covers the same behaviour.
```

## Deleted files are graded on where the cases went

The question a reviewer is actually asking is not "was a test file deleted" — the file list says that — but "did any coverage go with it". So overlock counts the cases and looks for them elsewhere in the same patch.

```
✗ HIGH  apps/web/app.test.tsx  TEST_REMOVED
     Test file deleted — 33 of 37 cases reappear elsewhere in this patch.
     4 did not: refuses a PDF larger than the store will take, cannot be given
     an amount that is not a number, formats the amount as US dollars while it
     is typed, keeps the row open when the period has been emptied
```

- **Every case re-homed** → `medium`. A refactor.
- **Any case missing** → `high`, and the missing ones are named. Up to a limit, after which the count is summarised — the full list is always in [`--json`](../reference/json-report.md).
- **The module the file is named after was deleted too** — `api.test.ts` alongside `api.ts` → `medium`. A module that was only _modified_ does not count.
- **No parsable cases at all** → `high`, `Test file deleted.`

When every case in a deleted file lands in exactly one other file, that is a move, and several moves are reported as a single finding rather than as a wall:

```
!  MED  src/old/ledger.test.ts  TEST_REMOVED
     8 test files deleted — all 63 of their cases reappear elsewhere in this
     patch: src/old/ledger.test.ts -> src/admin/api.test.ts, ...
```

## How a case is matched

Three attempts, in order:

1. By title.
2. By title with the patch's own rename applied — `lists ledger entries` becoming `lists admin entries` is not a deletion if the patch renamed `ledger` to `admin`. See [renames and reformatting](../under-the-hood/renames-and-reformatting.md).
3. By body.

**Matching is a heuristic, and the grade says so.** A case found again by name is not a guarantee that it still asserts what it did; it drops the finding to `medium` and points at where to look. A case that was deleted and genuinely rewritten from scratch under a new title reads as deleted, because from the patch's point of view it was.

## Renamed out of the glob

```
✗ HIGH  src/auth.checks.ts  TEST_REMOVED
     Test file renamed out of the test glob (was src/auth.test.ts).
     -> Rename it back, or move the cases into a file the runner still collects.
```

The file still exists and its cases are all still written down. The runner no longer collects it, which as far as the suite is concerned is the same as deleting it — quieter, and harder to notice in a file list. If the new name is intentional, teach overlock and the runner about it with [`--test-glob`](../reference/configuration.md).

## Suppressing it

A deleted file has no line to sit on — the path no longer has a line 1 — so name the path, from any line the patch still has:

```ts
// overlock-ignore TEST_REMOVED src/api.test.ts -- module deleted; cases re-homed in admin/api.test.ts
```

Or, for a move too broad to annotate:

```
Overlock-Allow: TEST_REMOVED "src/api.test.ts::rejects expired tokens" -- ported to tokens.test.ts
```

The fix hint says the same thing the tool wants you to internalise: saying it in the commit message explains it to a reviewer, but nothing reads that. [Suppressions](../reference/suppressions.md) has both forms in full.
