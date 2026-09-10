---
title: The thirteen rules
description: The full table, what the rules have in common, and why the IDs never change meaning.
sidebar:
  order: 1
---

Thirteen rules, all scoped to the patch. Each one has a frozen ID, a grade, and a single question it asks about the diff.

| Rule                                                          | Severity      | Fires when                                                                                                                                                               |
| ------------------------------------------------------------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [`TEST_REMOVED`](test-removed.md)                             | high / medium | A test file is deleted or renamed out of the runner's glob; a case disappears from a surviving file                                                                      |
| [`TEST_GATE_DISABLED`](test-gate-disabled.md)                 | high / medium | The suite stops gating the build: `continue-on-error: true` on a test step, `\|\| true` after a test command, `--passWithNoTests`, or the job that ran the tests deleted |
| [`TEST_SKIPPED_ADDED`](test-skipped-added.md)                 | high          | `it.skip`, `xit`, `.todo`, `@pytest.mark.skip`, `t.Skip()`, `#[ignore]`, `@Disabled` — and `.only`, which silences everything else                                       |
| [`ASSERTION_WEAKENED`](assertion-weakened.md)                 | high          | An assertion stops naming a value: `toBe(3)` becomes `toBeDefined()`, `toBeTruthy()` or `not.toBeNull()`                                                                 |
| [`ASSERTION_NARROWED`](assertion-narrowed.md)                 | high          | An assertion keeps naming a value but covers less of it: a whole object becomes one field                                                                                |
| [`PREDICATE_NARROWED`](predicate-narrowed.md)                 | high / medium | The set an assertion ranges over shrinks: a filter gains a condition, a case table loses rows, an exclusion list grows                                                   |
| [`SUITE_SCOPE_NARROWED`](suite-scope-narrowed.md)             | high / medium | The set the runner collects shrinks: an include glob narrowed, an include list losing patterns, an exclude list growing, a test command gaining a filter                 |
| [`COVERAGE_THRESHOLD_LOWERED`](coverage-threshold-lowered.md) | high          | A coverage or mutation threshold drops, or disappears                                                                                                                    |
| [`ASSERTION_REMOVED`](assertion-removed.md)                   | medium        | A test file ends the patch with fewer assertions than it started with                                                                                                    |
| [`EXPECTED_VALUE_CHANGED`](expected-value-changed.md)         | medium        | An assertion keeps its shape but its expected literal was edited                                                                                                         |
| [`SNAPSHOT_UPDATED_WITH_CODE`](snapshot-updated-with-code.md) | medium        | A snapshot was regenerated in the same patch as the code it snapshots                                                                                                    |
| [`TEST_TIMEOUT_RAISED`](test-timeout-raised.md)               | low           | A timeout or retry count went up, or appeared                                                                                                                            |
| [`TEST_AND_IMPL_TOGETHER`](test-and-impl-together.md)         | low           | A test changed alongside the implementation it is named after                                                                                                            |

Only `high` fails a run by default. See [severity](../learn/severity.md) for what each grade is claiming and how to move a single rule without moving the bar.

## What they have in common

Every rule reads the patch and only the patch. None of them runs your tests, imports your code, or asks a model what the change was for.

That gives all thirteen the same shape of claim: _this text became that text, and the second one asks less than the first._ You can check any finding by reading two lines, which is the property that makes the tool usable as a gate rather than as an opinion.

It also gives them all the same blind spot. A rule cannot see that the case you deleted was covering a feature you also deleted, that the threshold you lowered was set by a script last week, or that the assertion you loosened is now covered by a new test three files away. `medium` is where overlock says it found something that might account for the change and cannot verify it; [suppressions](../reference/suppressions.md) are where you say so when it did not find it.

## Three families

**Something stopped running.** `TEST_REMOVED`, `TEST_SKIPPED_ADDED`, `PREDICATE_NARROWED`, `TEST_GATE_DISABLED`, `SUITE_SCOPE_NARROWED`. The assertions may be untouched — there are just fewer occasions to run them. `PREDICATE_NARROWED` is the sharpest version: it can fire on a patch where every `expect` is byte for byte identical.

**Something asks less.** `ASSERTION_WEAKENED`, `ASSERTION_NARROWED`, `ASSERTION_REMOVED`, `EXPECTED_VALUE_CHANGED`, `COVERAGE_THRESHOLD_LOWERED`. The tests still run; they accept more than they used to.

**The suite's own gate.** `TEST_GATE_DISABLED` and `SUITE_SCOPE_NARROWED` belong to the first family, but they get there by a different route: they are the only two rules that read a file with no assertions in it. A suite can be made to ask less without any test file changing at all — the workflow stops failing on it, or the runner stops collecting it. See [TEST_GATE_DISABLED](test-gate-disabled.md) and [SUITE_SCOPE_NARROWED](suite-scope-narrowed.md).

**Something is worth knowing.** `SNAPSHOT_UPDATED_WITH_CODE`, `TEST_TIMEOUT_RAISED`, `TEST_AND_IMPL_TOGETHER`. Not evidence on their own. Useful next to the others — `TEST_AND_IMPL_TOGETHER` in particular exists to tell you _which_ implementation change the rest of the findings are about.

## The IDs are frozen

Rule IDs are the API. Adding a rule is a minor release; changing what an existing ID means is a breaking one.

They have to be, because they appear in three places that outlive any single run: `overlock-ignore` directives sitting in source files, `Overlock-Allow:` trailers in commit history, and `--severity` entries in committed config. If `ASSERTION_NARROWED` quietly grew to cover a new pattern, every suppression naming it would silently start covering more than the person who wrote it agreed to.

An unknown rule ID in a directive silences nothing, rather than being ignored quietly — so a typo fails loudly instead of leaving a finding un-suppressed and a comment claiming otherwise.

The same freeze applies to the [JSON report](../reference/json-report.md), where `RULE_IDS` is exported for anything building on the output.

## Recognising test files

The rules that are about tests need to know which files are tests. That is conventional, across TypeScript, JavaScript, Python, Go, Rust, Java, Kotlin, Ruby and C# — see [how it reads a patch](../learn/how-it-reads-a-patch.md#which-files-are-tests) for the list and for `--test-glob`, which adds your own.

Four rules are about files that are not tests: `COVERAGE_THRESHOLD_LOWERED` reads config files, `SNAPSHOT_UPDATED_WITH_CODE` reads snapshots, and `TEST_GATE_DISABLED` and `SUITE_SCOPE_NARROWED` read CI and runner config.
