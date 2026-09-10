---
title: EXPECTED_VALUE_CHANGED
description: An assertion kept its shape and its expected literal was edited.
sidebar:
  order: 11
---

**Severity: `medium`.**

```diff
- expect(invoice.total).toBe(1240);
+ expect(invoice.total).toBe(1180);
```

```
!  MED  src/invoice.test.ts:52  EXPECTED_VALUE_CHANGED
     Expected value changed: 1240 → 1180
     -> Confirm the new value is the correct one, not just the one the code produces now.
```

The assertion is exactly as strong as it was. Same matcher, same subject, same precision. Only the number moved.

Which is fine, if the number moved because the correct answer changed. It is not fine if the number moved because the code started producing 1180 and 1180 was easier to type than to explain — and from the diff, those two are the same edit.

So this rule does not accuse. It asks one question, in the fix hint: **is the new value the correct one, or just the one the code produces now?** That question has an answer, you know it, and the finding costs you five seconds when you do.

## Why `medium`

Updating an expected value is completely ordinary work. Prices change, formats change, a rounding rule is corrected. If this failed runs by default it would fail most patches that touch a test, and everyone would learn to route around it.

At `medium` it is printed, counted and available in the [JSON report](../reference/json-report.md), and it sits in the list next to whatever else the patch did — which is where it earns its keep. `EXPECTED_VALUE_CHANGED` alone is a Tuesday. `EXPECTED_VALUE_CHANGED` in the same file as a [`SNAPSHOT_UPDATED_WITH_CODE`](snapshot-updated-with-code.md) and an [`ASSERTION_WEAKENED`](assertion-weakened.md) is a story.

## What it does not fire on

An assertion whose matcher changed. That is a [weakening](assertion-weakened.md) or a [narrowing](assertion-narrowed.md), and it is reported as one — a single edit produces one finding, from the rule that describes it best.

## Suppressing it

```ts
// overlock-ignore EXPECTED_VALUE_CHANGED -- VAT went to 21% in #1180
expect(invoice.total).toBe(1180);
```

Worth noting that this is one of the rare cases where the suppression comment is genuinely better documentation than the assertion it sits on. A number in a test tells you what the answer is; the directive tells you why it changed.
