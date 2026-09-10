---
title: TEST_GATE_DISABLED
description: The tests still run, and failing them is now free.
sidebar:
  order: 3
---

**Severity: `high` when the diff shows what is being switched off, `medium` when it cannot.**

Every other rule reads a test file. This one reads the file that decides whether any of it counts.

```diff
  - name: test
    run: pnpm test
+   continue-on-error: true
```

```
✗ HIGH  .github/workflows/ci.yml:31  TEST_GATE_DISABLED
     `continue-on-error: true` added to a step that runs tests — the suite can
     fail without failing the build.
     -> Take it off the test step. A test failure that does not fail the build is not a gate.
```

Not a single test changed. The suite still runs, still reports, still goes red — and the build is green either way. This is the quietest edit in the catalogue, because a workflow file holds no assertions and a reviewer scanning a patch for weakened tests is not looking at it.

## The four shapes it watches

**A neutralised test command.** `|| true`, `|| :`, `|| exit 0` or `; true` after something that runs tests. Graded `high` with no context needed — the neutraliser is sitting on the command, so the line says what it does on its own.

```diff
-  "test": "vitest run"
+  "test": "vitest run || true"
```

**`continue-on-error: true` or `if: false`** added to a step. `high` when the surrounding hunk names a test step or job, `medium` when it does not — see [the two grades](#the-two-grades).

**`--passWithNoTests`.** An empty run reported as a passing run. Always `medium`: it is legitimate in a package that genuinely has no tests, and a diff cannot tell that package from one whose tests just stopped being collected.

```
✗ MED   package.json:14  TEST_GATE_DISABLED
     Runner told to pass when it collects no tests — an empty run is now a green run.
     -> Check the runner still collects the tests it did. The flag is only safe where a package genuinely has none.
```

**A test invocation deleted with nothing running it instead.** Delete the job that ran the tests and every test in the repository survives byte for byte. This fires only when nothing else in the patch invokes the same suite, so a job moved between workflows or a command rewritten in place is silent.

```
✗ HIGH  .github/workflows/ci.yml  TEST_GATE_DISABLED
     Removed — 2 test invocations gone from this gate, and nothing in this patch
     runs them instead.
     -> Put the invocation back, or point at where the suite runs now. Nothing in the patch does.
```

One finding per file, not per line: deleting a workflow that ran tests in four jobs is one decision, and four acknowledgements for it is three more than anybody reads. A deleted file reports with `line: null`, because there is no line left to go and look at.

## Which files it reads

CI and runner config only — GitHub workflows and composite actions, `.gitlab-ci.yml`, CircleCI, Azure Pipelines, Travis, Bitbucket, Buildkite, Drone, `Jenkinsfile`, `Makefile`, `justfile`, any `.sh`, and the runner configs listed under [`SUITE_SCOPE_NARROWED`](suite-scope-narrowed.md#which-files-it-reads).

A `|| true` in a deploy script that never ran tests is not a finding: the line has to carry a recognised test invocation. And a commented-out line is a note, not a gate — `#` opens a comment in YAML, a Makefile and a shell script, which between them are most of what this rule reads.

## The two grades

`high` is for a diff that establishes what is being switched off: a neutraliser on a test command, a `continue-on-error:` in a hunk whose context names a test step, a test invocation removed with no replacement.

`medium` is for a diff that cannot. A patch carries three lines of context, which is usually enough to see the `run:` or the `name:` a bare `continue-on-error: true` belongs to. When it is not, the finding is graded down rather than dropped — the alternative is either a false positive on ordinary CI tuning or a silence on the real thing, and grading down is the honest third option.

## Suppressing it

The `Overlock-Allow:` trailer is usually the better fit here, because the decision belongs to the pull request rather than to a line in a config file:

```
Overlock-Allow: TEST_GATE_DISABLED -- flaky-e2e quarantined this sprint, tracked in #412
```

An inline directive works too where the file takes comments:

```yaml
# overlock-ignore TEST_GATE_DISABLED -- this step lints, the test step is below
continue-on-error: true
```

If your repository has decided the rule says nothing useful here, grade it off in config rather than writing the same acknowledgement every sprint — see [when the finding is wrong](../learn/false-positives.md#fourth-and-only-for-a-rule-you-keep-answering-grade-it-off).
