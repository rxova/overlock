---
title: ASSERTION_WEAKENED
description: An assertion stopped naming a value — toBe(3) became toBeDefined(), toBeTruthy() or not.toBeNull().
sidebar:
  order: 4
---

**Severity: `high`, or `medium` when the case gained assertions overall.**

The test still runs. It just no longer says what it expects.

```diff
- expect(user.role).toBe('admin');
+ expect(user.role).toBeDefined();
```

```
✗ HIGH  src/auth.test.ts:31  ASSERTION_WEAKENED
     An exact assertion was replaced with one that only checks that a value is present.
     -> Assert the value, not that a value is present.
```

`toBeDefined()` passes for `'admin'`, for `'guest'`, for `''`, and for the string `'undefined'`. The line looks like an assertion and costs the same to read as the one it replaced, which is what makes it worth flagging: this is the shape of test-weakening that survives review most reliably.

## What counts as weakening

An assertion that named a value being replaced by one that does not:

- `toBeDefined()`, `toBeTruthy()`, `toBeFalsy()`
- `toBeInstanceOf(...)` — the type, not the value
- a bare `toHaveBeenCalled()` where `toHaveBeenCalledWith(...)` was
- `expect.any(...)` in the position a literal held
- `not.toBeNull()` — which asserts presence and nothing at all about the value

Each of these has a `checks` phrase that appears in the message, so the finding says what the new assertion _does_ check: `that a value is present`, `that a value is truthy`, `that a value is falsy`, `the type`, `that it was called at all`.

## What is not a weakening

`toBeNull()`, `toBeUndefined()` and `toBe(false)` are not treated as weakenings.

Each of them names exactly one value, as precisely as `toBe(3)` does. `toBe(3)` → `toBeNull()` is a _different_ assertion, not a looser one, and calling it a weakening would make the rule fire on ordinary behaviour changes and teach people to ignore it.

The distinction that matters is not "is the matcher specific-sounding" but "does the assertion still pin the value down to one thing".

## Grading is per case, not per line

overlock reads the whole test case, not the line in isolation. A case that lost specificity on one line while gaining assertions elsewhere is graded `medium`, and the message says how many it gained:

```
!  MED  src/auth.test.ts:31  ASSERTION_WEAKENED
     An exact assertion was replaced with one that only checks that a value is
     present. The case gained 2 assertions overall.
```

A case that only lost stays `high`.

Pairing is deliberately tight. A removal is matched with an addition **in the same edit** — not one three context lines away in the next case — and is not paired at all when the assertion it removed still appears further down the file. Loose pairing would let any patch that adds an assertion anywhere in the file explain away a weakening somewhere else, which is the exact excuse the rule exists to refuse.

## Suppressing it

```ts
// overlock-ignore ASSERTION_WEAKENED -- the exact role is asserted in the case below
expect(user.role).toBeDefined();
```

If the value genuinely cannot be pinned down — a generated ID, a timestamp — consider whether the assertion is doing any work at all. `expect(id).toBeDefined()` on a value the code just returned is close to asserting that the function returned. See [when the finding is wrong](../learn/false-positives.md).

## Related

- [`ASSERTION_NARROWED`](assertion-narrowed.md) — the assertion still names a value, it just covers less of it.
- [`ASSERTION_REMOVED`](assertion-removed.md) — the assertion is gone rather than loosened.
- [`EXPECTED_VALUE_CHANGED`](expected-value-changed.md) — same shape, different literal.
