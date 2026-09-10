---
title: overlock
description: A deterministic CLI that reads a git patch and reports the edits that make a test suite ask less than it did.
---

A test suite went green. That is the good news and the whole problem, because there are two ways to get there: fix the code, or lower the bar. From the outside they look identical. The run is green either way, the CI badge is green either way, and the diff that did it is somewhere in the middle of forty other files.

overlock reads the patch and answers one question:

> Did this change make the tests pass by weakening the tests?

It is a CLI. It reads a git diff, applies eleven rules, and prints what it found. There are no model calls, no network calls and no telemetry, and the published package has zero runtime dependencies, so `npx overlock` on a cold cache is one small download.

```console
$ npx overlock
overlock — 2 findings (2 high)  (HEAD)

✗ HIGH  src/auth.test.ts:42  TEST_SKIPPED_ADDED
     .skip added — this test no longer runs.
     + it.skip('rejects expired tokens', async () => {
     -> Make the test pass, or delete it deliberately and say why.

✗ HIGH  vitest.config.ts:18  COVERAGE_THRESHOLD_LOWERED
     Threshold "statements" lowered from 95 to 40.
     - statements: 95,
     + statements: 40,
     -> Raise the number back and make the code meet it.
```

## Try it on the change you have open

```bash
npx overlock
```

That runs against the current patch — uncommitted work if there is any, otherwise the commits this branch has made since it left the default branch. Requires Node.js 20.11 or newer. [The CLI reference](reference/cli.md) has every flag; [how the base is chosen](learn/how-it-reads-a-patch.md) explains what "the current patch" resolves to and why.

## Wire it into the agent

The reason this tool exists is that agents are relentless about green. Ask one to make the suite pass and it will, and one of the routes there is `it.skip`. A human doing that in a pull request gets a comment. An agent doing it at 2am gets a merge.

```bash
npx overlock init claude
```

That writes a committed `.claude/settings.json` with a `Stop` hook. When the agent tries to end its turn, overlock runs, and the turn is blocked while a finding at or above the threshold stands. Not a suggestion the model can talk itself out of — a gate on the transcript. See [Claude Code](integrations/claude-code.md), and [other agents](integrations/other-agents.md) for Codex, Cursor and Copilot, which get an advisory instruction instead because they have no equivalent hook.

## What it looks at

Eleven rules, all scoped to the patch, all graded `high`, `medium` or `low`. Only `high` fails a run by default.

| Rule                                                                | Severity      | Fires when                                                                                                                         |
| ------------------------------------------------------------------- | ------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| [`TEST_REMOVED`](rules/test-removed.md)                             | high / medium | A test file is deleted or renamed out of the runner's glob; a case disappears from a surviving file                                |
| [`TEST_SKIPPED_ADDED`](rules/test-skipped-added.md)                 | high          | `it.skip`, `xit`, `.todo`, `@pytest.mark.skip`, `t.Skip()`, `#[ignore]`, `@Disabled` — and `.only`, which silences everything else |
| [`ASSERTION_WEAKENED`](rules/assertion-weakened.md)                 | high          | An assertion stops naming a value: `toBe(3)` becomes `toBeDefined()`                                                               |
| [`ASSERTION_NARROWED`](rules/assertion-narrowed.md)                 | high          | An assertion keeps naming a value but covers less of it                                                                            |
| [`PREDICATE_NARROWED`](rules/predicate-narrowed.md)                 | high / medium | The set an assertion ranges over shrinks                                                                                           |
| [`COVERAGE_THRESHOLD_LOWERED`](rules/coverage-threshold-lowered.md) | high          | A coverage or mutation threshold drops, or disappears                                                                              |
| [`ASSERTION_REMOVED`](rules/assertion-removed.md)                   | medium        | A test file ends the patch with fewer assertions than it started with                                                              |
| [`EXPECTED_VALUE_CHANGED`](rules/expected-value-changed.md)         | medium        | An assertion keeps its shape but its expected literal was edited                                                                   |
| [`SNAPSHOT_UPDATED_WITH_CODE`](rules/snapshot-updated-with-code.md) | medium        | A snapshot was regenerated in the same patch as the code it snapshots                                                              |
| [`TEST_TIMEOUT_RAISED`](rules/test-timeout-raised.md)               | low           | A timeout or retry count went up, or appeared                                                                                      |
| [`TEST_AND_IMPL_TOGETHER`](rules/test-and-impl-together.md)         | low           | A test changed alongside the implementation it is named after                                                                      |

Test files are recognised by the conventions of TypeScript, JavaScript, Python, Go, Rust, Java, Kotlin, Ruby and C#. [The rules overview](rules/overview.md) covers the table as a whole; each row links to the page for that rule.

## What it will not do

overlock does not run your tests. It does not evaluate whether your implementation is correct. It does not use a model to judge intent, and it has no opinion about whether your change is a good idea. **A finding is a statement about the diff and nothing more.**

That narrowness is what makes it usable as a gate. A tool that guesses at intent has to be argued with; a tool that reports a substitution in a patch can be believed or checked in ten seconds. It also means overlock is wrong in a specific, boring way — it will occasionally flag a change that was entirely correct. [False positives](learn/false-positives.md) is about what to do then, and the answer is never "turn the rule off".

## Where to go next

- [Why this exists](learn/why.md) — the failure mode, and why a linter does not catch it.
- [How it reads a patch](learn/how-it-reads-a-patch.md) — base resolution, untracked files, what "the current patch" means.
- [Severity](learn/severity.md) — what `high` is claiming, and why `--fail-on` and `--severity` are different knobs.
- [Suppressions](reference/suppressions.md) — silencing a finding by name, with a reason, on the record.
- [The JSON report](reference/json-report.md) — the schema, which is the API.
