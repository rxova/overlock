---
title: How it reads a patch
description: What "the current patch" resolves to, why the default is not git diff, and which files are in scope.
sidebar:
  order: 2
---

Every overlock verdict states what it examined:

```
overlock — 2 findings (2 high)  (origin/main)
     83 files, 3 commits, against 492b7ad
```

That line is not decoration. Almost every confusing result — a rule that did not fire, a run that reported nothing, a deletion that seems invented — is a disagreement about which patch was read. Start there.

## The default: `--base auto`

`auto` resolves in order:

1. **Uncommitted work**, if there is any. Working tree plus index.
2. Otherwise, **this branch's commits since it left the default branch**.
3. Otherwise, **the last commit**.

The order matters most in the agent case. An agent commonly commits and _then_ stops, so a hook that only looked at the working tree would find it empty and pass everything. Falling through to the branch's commits means a run immediately after the agent committed still sees what it committed. The same resolution is used by the CLI, the [Stop hook](../integrations/claude-code.md) and the [MCP tool](../integrations/mcp.md), so all three see the same patch.

`--explain-base` prints how the base was chosen and then runs. When a result surprises you, that is usually the flag.

## `--base <ref>` means the fork point

```bash
overlock --base main
```

This is `main...HEAD` — what this branch did since it left `main`. It is deliberately **not** `git diff main`.

`git diff main` compares `main`'s current tip against your working tree. The moment `main` moves ahead of where you branched, every file `main` gained since then reads as a deletion in your patch, and a test file somebody else added on `main` this morning becomes a `TEST_REMOVED` finding against you. That is not a hypothetical failure mode; it is the normal state of any branch older than a day.

If you genuinely want the literal comparison:

```bash
overlock --base main --base-mode direct
```

`direct` is the right mode when you are comparing two refs on purpose — a release branch against a tag, say — and the wrong mode for reviewing a branch.

## Staged only

```bash
overlock --staged
```

Asks what the index holds, and nothing else. Useful in a pre-commit hook, where the question is about the commit you are making rather than the branch you are on.

## Untracked files count

Files git has not seen yet are included by default and rendered as additions.

This is the difference between catching a new test file that arrives already skipped and not catching it. `git diff HEAD` reports nothing about an untracked file — as far as git is concerned it does not exist — so without this, an agent that creates `auth.test.ts` with three `it.skip` blocks produces a completely clean run.

`--no-untracked` opts out. `--staged` never includes them, because a file that is not in the index is not part of what the index holds.

overlock reads untracked files. It never stages them, and it never writes to the git index. See [untrusted input](../under-the-hood/untrusted-input.md) for the rest of the boundary.

## Which files are tests

Test files are recognised by convention across TypeScript, JavaScript, Python, Go, Rust, Java, Kotlin, Ruby and C#: `.test.` / `.spec.` suffixes, `__tests__` and `tests/` directories, `test_*.py` and `*_test.py`, `_test.go`, `*Test.java`, `_spec.rb`, `*Tests.cs`, and so on.

If your project has a convention of its own, add it:

```bash
overlock --test-glob '\.check\.ts$'
```

The value is a regular expression matched against the path, and the flag repeats. Put it in the [config file](../reference/configuration.md) rather than in each invocation, so the hook and CI agree with your terminal.

## Files that are not tests, and are read anyway

Four rules ask about files no convention would call a test.

Snapshot files (`.snap`, `__snapshots__/`, `.ambr`) and coverage-threshold config files (`vitest.config.*`, `jest.config.*`, `.nycrc`, `pyproject.toml`, `codecov.yml`, and friends) are recognised separately, because `COVERAGE_THRESHOLD_LOWERED` and `SNAPSHOT_UPDATED_WITH_CODE` are about files that are not themselves tests.

**CI config** — `.github/workflows/*`, composite `action.yml`, `.gitlab-ci.yml`, `.circleci/config.yml`, `azure-pipelines.yml`, `.travis.yml`, `bitbucket-pipelines.yml`, `.buildkite/`, `.drone.yml`, `Jenkinsfile`, `Makefile`, `justfile` and shell scripts — is read by [`TEST_GATE_DISABLED`](../rules/test-gate-disabled.md), because the shortest way to stop a suite failing a build is not to touch a test at all.

**Runner config** — `vitest.config.*`, `jest.config.*`, `playwright.config.*`, `cypress.config.*`, `karma.conf.*`, `.mocharc`, `.nycrc`, `package.json`, `pyproject.toml`, `pytest.ini`, `setup.cfg`, `tox.ini`, `phpunit.xml` and friends — is read by [`SUITE_SCOPE_NARROWED`](../rules/suite-scope-narrowed.md), because a suite can shrink by editing the list of what gets collected rather than the tests themselves.

Neither adds anything to the test-file question: `--test-glob` still only widens what counts as a test.

## An empty patch is not a pass

A range that turned out to hold nothing is reported as empty, not as a clean run:

```console
$ overlock --base main
overlock: nothing to check — the patch is empty.  (main)
```

This matters in CI, where a misconfigured base is silent otherwise: the job goes green, every run, forever, and nobody notices that the gate stopped being a gate. `--fail-on-empty` turns an empty patch into exit 1 so the misconfiguration is loud.

## What it does not read

overlock reads the patch. It does not read your test results, your coverage output, your issue tracker, or the rest of the repository beyond what the patch touches and the files it needs to resolve a case match.

It does not run your CI config either. It reads the diff of it — which is why `TEST_GATE_DISABLED` can drop to `medium` on a bare `continue-on-error: true` whose step header is outside the patch's three lines of context: it can see the switch, and not always what the switch is on.

So it cannot tell you that the test you deleted was the only one covering a module — it can only tell you that you deleted it, and whether the cases in it reappear somewhere else in the same patch. That distinction runs through every rule, and [scope](../under-the-hood/scope.md) is the long version of it.
