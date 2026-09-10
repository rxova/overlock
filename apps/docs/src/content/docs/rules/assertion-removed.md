---
title: ASSERTION_REMOVED
description: A test file ends the patch with fewer assertions than it started with.
sidebar:
  order: 8
---

**Severity: `medium`.**

The counting rule. Everything else in the assertion family compares a specific line against the specific line that replaced it; this one just counts.

```
!  MED  src/ledger.test.ts:64  ASSERTION_REMOVED
     3 assertions removed and not replaced.
     - expect(row.state).toBe('settled');
     -> If the behaviour still holds, assert it. If it does not, the test was telling you something.
```

"Not replaced" is the load-bearing part. This fires on the balance for the file across the whole patch — assertions removed, minus assertions added. A file that rewrote twenty assertions and kept the count produces nothing. A file that quietly ended up with three fewer produces this, even if the three came from three different cases and no single line looks suspicious.

It is `medium` because a shrinking assertion count has plenty of innocent causes. You deleted a feature. You replaced four assertions with one `toEqual` that covers all of them — real, and common. The count went down and the coverage did not.

## Why it exists next to the other rules

[`ASSERTION_WEAKENED`](assertion-weakened.md) and [`ASSERTION_NARROWED`](assertion-narrowed.md) need a pairing: this line went away, that line arrived, and the second asks less. Tight pairing is what makes those two trustworthy at `high`, and tight pairing means a removal with no addition anywhere near it does not pair with anything.

Without this rule, deleting an assertion outright would be the one edit in the family that produced nothing at all — strictly worse than loosening it, and rewarded for it.

## The fix hint is the useful part

> If the behaviour still holds, assert it. If it does not, the test was telling you something.

That is the whole decision. An assertion that was removed because it started failing is the case this tool exists for. An assertion that was removed because the behaviour genuinely went away is fine, and takes one line to say so.

## Suppressing it

The finding sits on the first removed assertion's old line, so a directive above it works:

```ts
// overlock-ignore ASSERTION_REMOVED -- the four field assertions collapsed into one toEqual below
```

For a file-wide restructure, a trailer is less noisy:

```
Overlock-Allow: ASSERTION_REMOVED src/ledger.test.ts -- settlement moved to its own spec
```
