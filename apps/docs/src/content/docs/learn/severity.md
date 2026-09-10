---
title: Severity
description: What high is claiming, why only high fails, and why --fail-on and --severity are different knobs.
sidebar:
  order: 3
---

Every finding is `high`, `medium` or `low`. Only `high` fails a run by default. A rule can also be graded `off`, which is not a fourth severity — see [grading a rule off](#grading-a-rule-off).

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

Six rules grade per finding rather than per rule:

- [`TEST_REMOVED`](../rules/test-removed.md) — `high` when cases vanish, `medium` when they are re-homed or the module went with them.
- [`PREDICATE_NARROWED`](../rules/predicate-narrowed.md) — `high` when the narrowed set drives a loop or a case table, `medium` when it is only assigned to a variable.
- [`ASSERTION_WEAKENED`](../rules/assertion-weakened.md) and [`ASSERTION_NARROWED`](../rules/assertion-narrowed.md) — `high` when the case only lost, `medium` when the case gained assertions overall, with the count in the message.
- [`TEST_GATE_DISABLED`](../rules/test-gate-disabled.md) — `high` when the diff shows what is being switched off, `medium` when it cannot: a bare `continue-on-error:` whose step the three lines of context do not reach, or a `--passWithNoTests` that may be honest.
- [`SUITE_SCOPE_NARROWED`](../rules/suite-scope-narrowed.md) — `high` when a runner config's collection list changes, `medium` when a test command gains a filter flag, because a suite split across two CI jobs and a suite cut in half look identical in a diff.

`--severity <RULE>=<grade>` collapses a two-grade rule into one grade. That is a real loss of information — you are throwing away a distinction the tool computed — so prefer to leave it alone unless the noise is costing you more than the distinction is worth.

## Grading a rule off

`off` is the end of the `--severity` range, not a fourth severity:

```bash
overlock --severity TEST_AND_IMPL_TOGETHER=off
```

It is the right answer for a rule your repository has read enough of to judge that it says nothing here. `TEST_AND_IMPL_TOGETHER` is the usual candidate — it fires on ordinary test-driven work by design, and a repository that has decided so should not have to write an inline directive per finding to keep saying it.

What an `off` rule drops is counted and said out loud, on clean runs too:

```console
$ overlock
✓ overlock: nothing weakened in this patch. (9 silenced by config)
```

That number is the point. An escape hatch nobody can count is one that quietly empties the gate, and a green line standing on nine findings nobody sees is worse than no gate at all. In the [JSON report](../reference/json-report.md) it is the `silenced` field, next to `suppressed` for the ones a directive silenced.

No finding is ever reported with severity `off`, and `counts` keeps its three keys. `off` is something a rule can be set to; it is not something a finding can carry.

Like any regrade, it belongs in the [config file](../reference/configuration.md) rather than in a flag somebody remembers to pass, so CI and the hook agree with you.

## Suppression is not regrading

If a specific finding is correct-but-fine, do not regrade the rule that produced it. Regrading is permanent and global; the finding you are trying to get past is one line in one patch. Silence that one by name, with a reason, and leave the rule where it is — see [suppressions](../reference/suppressions.md).

The three levers, shortest reach first: **suppress** one finding you have read, **regrade** a rule whose grade is wrong for your repository, **grade off** a rule whose question does not apply to it. Reaching for the third when the first would do is how a gate empties.
