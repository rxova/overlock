---
'overlock': minor
---

Add `TEST_GATE_DISABLED` and `SUITE_SCOPE_NARROWED`, two rules that read the
files deciding whether a suite runs at all rather than the files it is written
in.

A suite can be made to ask less than it did without any test file changing, and
until now every one of these was silent:

```yaml
- name: test
  run: pnpm test
+ continue-on-error: true
```

```json
-  "test": "vitest run"
+  "test": "vitest run || true"
```

```ts
-  include: ['src/**/*.test.ts', 'e2e/**/*.test.ts'],
+  include: ['src/**/*.test.ts'],
```

`TEST_GATE_DISABLED` covers the failure being made free: `continue-on-error:
true` or `if: false` on a step that runs tests, a `|| true` / `|| exit 0` /
`; true` after a test command, `--passWithNoTests`, and a test invocation
deleted from a workflow with nothing in the patch running it instead. It is
`high` when the diff shows what is being switched off and `medium` when it
cannot — a `continue-on-error:` whose step the diff does not reach, or
`--passWithNoTests`, which is legitimate in a package that genuinely has none.
A command rewritten in place or a job moved between workflows is silent.

`SUITE_SCOPE_NARROWED` covers the set the runner collects: an `include` or
`testMatch` list that loses patterns or is replaced by a glob inside it, an
`exclude` or `testPathIgnorePatterns` list that gains one, and a test command
that gains a filter flag. The first of those is `PREDICATE_NARROWED` one level
up — a runner's include list is the set the whole suite ranges over — and the
mirror of the `TEST_REMOVED` case for a test file renamed out of the runner's
glob: same outcome, glob moved off the file rather than file moved out of the
glob. List changes are `high`; a filter flag is `medium`, because a suite split
across two CI jobs and a suite cut in half look identical in a diff.

Both read CI and runner config files only, so a marker in a test file or a
`|| true` in prose is still nobody's finding.
