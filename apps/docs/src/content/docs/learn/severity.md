---
title: Severity
description: What high is claiming, why only high fails, and why --fail-on and --severity are different knobs.
sidebar:
  order: 3
---

Every finding is `high`, `medium` or `low`. Only `high` fails a run by default.

The grades are not a confidence score. They are a claim about how much the patch itself establishes.

- **`high`** — the patch shows the suite asking less, and shows nothing that accounts for it. `it.skip` was added. A threshold went from 95 to 40. An assertion that named a value now names nothing.
- **`medium`** — the suite asks less on one line, and the patch contains something that might explain it. The case gained assertions elsewhere. The deleted file's cases turn up in another file. The module the test was named after was deleted too.
- **`low`** — context. Something worth knowing while you read the rest, and not by itself evidence of anything.

`medium` is the interesting grade, because it is where overlock says _I found the thing that might make this fine, and I cannot check whether it does._ A deleted case that reappears by name in another file has reappeared by name; whether it still asserts what it used to is not something a diff can answer. So the finding drops to `medium` and points at where to look.

## Only `high` fails

A run's exit code is decided by `--fail-on`, which defaults to `high`. `medium` and `low` findings are printed, counted, and included in the [JSON report](../reference/json-report.md), and they do not fail anything.

That is a deliberate ceiling on how annoying this tool is allowed to be. `TEST_AND_IMPL_TOGETHER` fires on ordinary test-driven work — you changed `parse.ts` and `parse.test.ts` in the same commit, which is what you are supposed to do. If that failed runs, everyone would turn overlock off within a week, and a gate people turn off catches nothing.

To tighten the gate:

```bash
overlock --fail-on medium   # medium and high fail
overlock --fail-on low      # everything fails
overlock --fail-on none     # nothing fails; report only
```

`--fail-on none` still prints and still writes the [ledger](../reference/ledger.md). It is the right setting for a first week on an existing repository, when you want the report before you want the gate.

## Regrading one rule is a different knob

Say `TEST_REMOVED` is `high`, and in your repository test files legitimately move around a lot, so it fires more than it should. The tempting fix is `--fail-on medium`.

Do not. Lowering `--fail-on` to unblock one rule also unblocks `TEST_SKIPPED_ADDED`, `ASSERTION_WEAKENED`, `ASSERTION_NARROWED`, `PREDICATE_NARROWED` and `COVERAGE_THRESHOLD_LOWERED`. You wanted to relax one rule and you relaxed the whole gate.

```bash
overlock --severity TEST_REMOVED=medium
```

That regrades that rule and leaves everything else alone. The flag repeats, and it belongs in the [config file](../reference/configuration.md) so CI and the hook agree with you.

It goes the other way too. `PREDICATE_NARROWED` grades some cases `medium` because a diff cannot establish that the narrowed set reaches an assertion. If your codebase makes that link obvious and you want both cases to block:

```bash
overlock --severity PREDICATE_NARROWED=high
```

**`--fail-on` sets where the bar is. `--severity` moves one rule relative to it.** Reach for the second one far more often than the first.

## Which rules carry two grades

Three rules grade per finding rather than per rule:

- [`TEST_REMOVED`](../rules/test-removed.md) — `high` when cases vanish, `medium` when they are re-homed or the module went with them.
- [`PREDICATE_NARROWED`](../rules/predicate-narrowed.md) — `high` when the narrowed set drives a loop or a case table, `medium` when it is only assigned to a variable.
- [`ASSERTION_WEAKENED`](../rules/assertion-weakened.md) and [`ASSERTION_NARROWED`](../rules/assertion-narrowed.md) — `high` when the case only lost, `medium` when the case gained assertions overall, with the count in the message.

`--severity <RULE>=<grade>` collapses a two-grade rule into one grade. That is a real loss of information — you are throwing away a distinction the tool computed — so prefer to leave it alone unless the noise is costing you more than the distinction is worth.

## Suppression is not regrading

If a specific finding is correct-but-fine, do not regrade the rule that produced it. Regrading is permanent and global; the finding you are trying to get past is one line in one patch. Silence that one by name, with a reason, and leave the rule where it is — see [suppressions](../reference/suppressions.md).
