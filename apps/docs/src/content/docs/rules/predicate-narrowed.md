---
title: PREDICATE_NARROWED
description: The set the assertions range over got smaller, while every expect stayed identical.
sidebar:
  order: 6
---

**Severity: `high` when the narrowed set drives a loop or a case table, `medium` when it is only assigned to a variable.**

This is the one rule that can fire on a patch where every `expect` is byte for byte unchanged.

```diff
- const rows = ledger.entries;
+ const rows = ledger.entries.filter((e) => e.state !== 'pending');

  for (const row of rows) {
    expect(row.total).toBe(expectedTotal(row));
  }
```

```
✗ HIGH  src/ledger.test.ts:14  PREDICATE_NARROWED
     Test input narrowed: the iterated source gained a .filter(...) step. The
     assertions are unchanged; there are fewer of them to run.
     -> Keep the set the assertions ranged over, or say what covers the members it no longer includes.
```

Nothing about the assertion got weaker. There are simply fewer occasions for it to run, and the ones that were failing are the ones that left. A diff reviewer reads the `expect` line, sees it untouched, and moves on.

## The four shapes it watches

**A filter predicate gained a conjunct.** `.filter((e) => e.active)` → `.filter((e) => e.active && !e.legacy)`. The message names the condition that was added.

**An iterated source gained a restricting step** — a `.filter(...)` or a `.slice(...)` between the source and the loop.

**A case table lost rows.** An `it.each([...])` that had eight rows and now has five: `5 values were iterated, now 3` — every row removed is a case that no longer runs, without a single `.skip`.

**A named exclusion list grew.** A list whose _name_ says it holds exemptions — `allow`, `allowlist`, `except`, `exclude`, `exempt`, `ignore`, `known`, `omit`, `pending`, `quarantined`, `skip`, `unsupported`, `waive`, `whitelist` and their relatives — gaining members:

```
✗ HIGH  src/lint.test.ts:9  PREDICATE_NARROWED
     Test input narrowed: knownFailures exempts 2 more: legacy-import, wide-union.
```

That last shape is where a lot of real suite decay lives. Adding a name to `knownFailures` is a one-line diff that reads as bookkeeping, and it is how a suite goes from covering everything to covering whatever still passes.

## The two grades

`high` when the narrowed set is consumed by a `for...of`, a `.forEach` or an `it.each`, because that set decides how many times the assertions below it run. The link between the narrowing and the lost coverage is right there in the patch.

`medium` when the set is only assigned to a variable. The narrowing is real, but a diff cannot establish that the variable ever reaches an assertion — it might feed a log line, a fixture, or a helper the patch does not show.

If your codebase makes that link reliable enough that both cases should block:

```bash
overlock --severity PREDICATE_NARROWED=high
```

See [severity](../learn/severity.md) for why that is a better move than lowering `--fail-on`.

## Suppressing it

```ts
// overlock-ignore PREDICATE_NARROWED -- pending entries are covered by "settles pending rows" below
const rows = ledger.entries.filter((e) => e.state !== 'pending');
```

The hint asks for the same sentence: say what covers the members the set no longer includes. When the answer is "nothing, and that is fine because the feature is gone", say that instead — the reason is the artefact, not the format.
