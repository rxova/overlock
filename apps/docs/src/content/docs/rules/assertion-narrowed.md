---
title: ASSERTION_NARROWED
description: An assertion still names a value but covers less of it — a whole object became one field.
sidebar:
  order: 5
---

**Severity: `high`, or `medium` when the case gained assertions overall.**

```diff
- expect(row).toEqual({ id, state, lapsedAt });
+ expect(row.lapsedAt).toBeNull();
```

```
✗ HIGH  src/ledger.test.ts:88  ASSERTION_NARROWED
     Assertion narrowed: row was checked as a whole, now only row.lapsedAt.
     -> Keep the assertion that covered the whole thing, or say what now covers the rest of it.
```

Both lines are exact assertions. `toBeNull()` names a value as precisely as `toEqual` does — this is not a [weakening](assertion-weakened.md). What changed is the _surface_: `id` and `state` were checked before, and now nothing checks them. A regression in either one now passes.

## The two shapes

**A subject narrowed to one of its parts.** `row` → `row.lapsedAt`. The message names both, because the useful sentence is the comparison.

**Fewer expected values in the same call.** `toHaveBeenCalledWith('row', 42)` → `toHaveBeenCalledWith('row')`:

```
✗ HIGH  src/ledger.test.ts:96  ASSERTION_NARROWED
     Assertion narrowed: 2 expected values checked, now 1.
```

The second shape is the one that hides best. It reads as a small tidy-up of an over-specified mock assertion, and about half the time that is exactly what it is — which is why the fix hint asks for the alternative rather than demanding a revert: _keep the assertion that covered the whole thing, or say what now covers the rest of it._

## Grading

Same as [`ASSERTION_WEAKENED`](assertion-weakened.md), and for the same reason: graded per test case rather than per line. A case that narrows one assertion while adding others is `medium` with the count in the message; a case that only narrowed stays `high`.

A removal is paired only with an addition in the same edit, and never when the original assertion still appears further down the file.

## Suppressing it

The honest suppression for this rule usually names where the rest went:

```ts
// overlock-ignore ASSERTION_NARROWED -- id and state are asserted in "creates the row" above
expect(row.lapsedAt).toBeNull();
```

Which is the hint, written down. If you cannot write that sentence, the rest of the object probably is not covered any more.

## Related

- [`ASSERTION_WEAKENED`](assertion-weakened.md) — the assertion stopped naming a value at all.
- [`PREDICATE_NARROWED`](predicate-narrowed.md) — the assertion is untouched; the set it runs over shrank.
