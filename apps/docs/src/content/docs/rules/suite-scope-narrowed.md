---
title: SUITE_SCOPE_NARROWED
description: The runner still runs. It just collects fewer tests than it did.
sidebar:
  order: 8
---

**Severity: `high` when a runner config's collection list changes, `medium` when a test command gains a filter flag.**

[`PREDICATE_NARROWED`](predicate-narrowed.md) watches the set an assertion ranges over. This is the same edit one level up: a runner's include list _is_ the set the whole suite ranges over.

```diff
  test: {
-   include: ['src/**/*.test.ts', 'e2e/**/*.test.ts'],
+   include: ['src/**/*.test.ts'],
  }
```

```
✗ HIGH  vitest.config.ts:9  SUITE_SCOPE_NARROWED
     The set the runner collects shrank: "include" lost 1 pattern: e2e/**/*.test.ts.
     -> Keep the set the runner collected, or say where the tests it no longer reaches are run.
```

Every e2e test in the repository is still there, still written, still passing when someone runs it by hand. Nothing collects them any more. This is also the mirror of the [`TEST_REMOVED`](test-removed.md) case for a file renamed out of the runner's glob — same outcome, glob moved off the file rather than the file moved out of the glob.

## The four shapes it watches

**An include list lost patterns.** `include`, `testMatch`, `testRegex`, `testPathPatterns`, `roots`, `testDir`, `spec`, `specPattern`, `testFiles` and their relatives. Reported with the patterns that left.

**An include list was replaced by something inside it.** `src/**/*.test.ts` → `src/core/**/*.test.ts` reads as a clarification and is a narrowing:

```
✗ HIGH  vitest.config.ts:9  SUITE_SCOPE_NARROWED
     The set the runner collects shrank: "include" narrowed: src/**/*.test.ts -> src/core/**/*.test.ts.
```

The old pattern is read as a matcher and the new one as a path handed to it, so this only fires when the new pattern genuinely sits inside the old one. A glob rewritten into an unrelated one — `*.test.ts` to `*.spec.ts` — matches nothing and says nothing, which is the right answer: that is a rename convention, not a narrowing.

**An exclude list grew.** `exclude`, `testPathIgnorePatterns`, `coveragePathIgnorePatterns`, `norecursedirs` and their relatives, gaining a member. The same set from the other side.

**A test command gained a filter flag.** `--project`, `-k`, `--grep`, `--testPathPattern`, `--testNamePattern`, `--filter`, `--spec`, `--dir`, `-run`. Graded `medium`:

```
✗ MED   .github/workflows/ci.yml:22  SUITE_SCOPE_NARROWED
     Test command gained a filter (`--project`) — the runner still collects every
     test and runs a subset of them.
     -> Say where the rest of the suite runs, or take the filter off. A subset that is green says nothing about the rest.
```

## Which files it reads

Runner config for the list changes: `vitest.config.*`, `jest.config.*`, `karma`, `nyc`, `stryker`, `playwright`, `cypress`, `wdio`, `ava`, `mocha` and `web-test-runner` configs, `.mocharc`, `.nycrc`, `package.json`, `pyproject.toml`, `pytest.ini`, `setup.cfg`, `tox.ini`, `phpunit.xml`.

CI config as well for the filter-flag shape, since that is where a test command usually lives — the list under [`TEST_GATE_DISABLED`](test-gate-disabled.md#which-files-it-reads).

An `include:` array in a file that is neither is nobody's finding. Lists are read across wrapped lines, because a member dropped from a multi-line array arrives in the diff as a lone quoted string with no key anywhere near it, and read line by line it is not a list change at all.

## The two grades

`high` for the lists, because a runner config says outright what it collects. There is no interpretation involved: the file names the set, and the set got smaller.

`medium` for a filter flag, because a suite split across two CI jobs and a suite cut in half look identical in a diff. Adding `--project=unit` to one step is a weakening if nothing runs the rest and a reasonable parallelisation if something does, and only one of those is visible from here.

## Suppressing it

```ts
// overlock-ignore SUITE_SCOPE_NARROWED -- e2e moved to its own runner, see e2e/vitest.config.ts
include: ['src/**/*.test.ts'],
```

That is the sentence the hint asks for: say where the tests the runner no longer reaches are run. If the honest answer is that nothing runs them any more, [`TEST_REMOVED`](test-removed.md) would have said the same thing about the files, and the reason to write down is why that is fine.
