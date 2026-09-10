---
title: COVERAGE_THRESHOLD_LOWERED
description: A coverage or mutation threshold dropped, or disappeared entirely.
sidebar:
  order: 9
---

**Severity: `high`.**

A coverage threshold is a promise about the suite, written down in a file the same patch can edit.

```diff
  coverage: {
-   statements: 95,
+   statements: 40,
  }
```

```
✗ HIGH  vitest.config.ts:18  COVERAGE_THRESHOLD_LOWERED
     Threshold "statements" lowered from 95 to 40.
     - statements: 95,
     + statements: 40,
     -> Raise the number back and make the code meet it.
```

This is the most literal edit in the whole rule set. The gate said 95, the code got to 40, and the gate said 40. Nothing else in the toolchain objects, because the config file is still valid and the coverage run now passes.

## A deleted threshold is the same finding

```
✗ HIGH  vitest.config.ts:18  COVERAGE_THRESHOLD_LOWERED
     Threshold "branches" (was 80) removed.
```

Removing the key is lowering it to zero with extra steps, and it is the version that looks tidier in a diff. Both are `high`.

## Which keys count

`statements`, `branches`, `functions`, `lines`, `fail_under`, `fail-under`, `minimum_coverage`, `min_coverage`, `coverage`, `threshold`, `thresholds`, `target`, `mutationScore`, `high`, `low`, `break`.

The last four cover mutation testing — Stryker's `mutationScore`, `high`, `low` and `break` are the same promise about a different measurement, and lowering `break` is how a mutation gate stops mattering.

Numeric separators are handled, so `1_000` and `1000` compare as the same number.

## Which files count

Files that are recognisably threshold config: `vitest.config.*`, `jest.config.*`, `karma.conf.*`, `.nycrc`, `nyc.config.*`, `stryker.conf.*`, `jest.config.json`, `codecov.yml`, `package.json`, `pyproject.toml`, `setup.cfg`, `.coveragerc`, `sonar-project.properties`, `tox.ini` — plus anything matching `*.config.js` / `*.config.ts` and friends.

The wider `*.config.*` net is why the rule sees a threshold you moved into a shared config module. It is also why the key list is conservative: a rule reading every config file in a repository needs to be sure that the number it found is a promise about the suite and not a page size.

## Suppressing it

There is a good reason to lower a threshold — you split a package, and the number that made sense for the old shape does not for the new one — and it is exactly the kind of decision that should be written down where the next person finds it.

```ts
// overlock-ignore COVERAGE_THRESHOLD_LOWERED -- e2e package split out; 95 was the combined number
statements: 80,
```

Or in the commit, for a config change too broad to annotate:

```
Overlock-Allow: COVERAGE_THRESHOLD_LOWERED -- baselining the inherited legacy package at its real coverage
```

What you should not do is regrade the rule. This is the one rule where the finding is never ambiguous: the number went down, in a file whose whole purpose is to hold that number.
