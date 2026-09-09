---
name: add-rule
description: Add a new detection rule to overlock end to end - rule ID, implementation, tests, docs, changeset. Use when adding a rule, a new skip marker or assertion pattern, or extending an existing rule to a new language or framework.
---

# Adding a rule

A rule is a pure function: `RuleContext` in, `Finding[]` out. It never reads the
filesystem, shells out, or depends on the order the other rules ran.

Before writing anything, answer these. They decide whether the rule ships and at
what severity.

1. **What edit does it catch?** State it as a before/after pair of diff lines.
2. **What looks identical and is legitimate?** List those cases. This is the
   part that decides the grade — and if the list is long and hard to separate,
   the rule is not ready.
3. **Is it visible in a unified diff alone?** A rule that would need to resolve
   imports, run the test suite or read files outside the patch cannot be a rule
   here.

## Steps

### 1. The ID

Append to `RULE_IDS` in `packages/overlock/src/types.ts`. Append — the array
order is part of the published contract, and existing IDs are frozen. Adding one
is a **minor** release; changing what an existing one means is **major**.

Name it for the edit, not the fix: `ASSERTION_WEAKENED`, not `RESTORE_ASSERTION`.

### 2. The implementation

Put it in the file under `packages/overlock/src/rules/` that already covers its
subject — `skip.ts`, `assertions.ts`, `removal.ts`, `thresholds.ts`,
`pairing.ts`, `predicates.ts` — or add a new file if it is genuinely a new
subject.

```ts
export const myRule: Rule = {
  rule: 'MY_RULE',
  run: ({ files, isTest, renamed }) => {
    /* ... */
  },
};
```

Use the helpers in `rules/shared.ts` rather than rolling your own:

- `finding(...)` builds the `Finding` and sanitises evidence and paths. Every
  finding goes through it.
- `withoutStringContents(text)` blanks the inside of string literals. Use it on
  any pattern match — a marker inside quotes is a fixture, a lint rule or a doc
  line, never tampering.
- `isTest(path)` is path-based test detection with `--test-glob` folded in.
- `renamed(text)` applies the patch's inferred substitution to a removed line.
  Use it when pairing a removal against an addition by text, or the rule goes
  blind to any edit made in the same commit as a rename. Evidence still quotes
  the line as the patch wrote it.

Guard language-specific markers on file extension. Go, Rust, JVM and .NET keep
tests in ordinary source files, so those patterns are not gated on the path
looking like a test — but without an extension guard, a Markdown table listing
the markers reads as tampering.

### 3. Register it

Add it to `RULES` in `packages/overlock/src/rules/index.ts`. Registry order is
report order for equal severities, so put it next to the rules it relates to.

### 4. Grade it

- `high` — a false positive here would be surprising, and blocking is the right
  default. Only put a rule here when you can defend every near-miss on your
  list.
- `medium` — worth a look, plausibly deliberate.
- `low` — true often enough on ordinary work that blocking would be noise;
  useful as context.

When in doubt, `medium`. A rule can be promoted later; a rule that blocks
wrongly gets the whole tool switched off.

If the rule has two defensible grades depending on what the diff can establish
(as `PREDICATE_NARROWED` and `TEST_REMOVED` do), return the lower one whenever
the diff cannot prove the stronger case.

### 5. Tests

Colocated, `*.test.ts`, using the fixtures in `src/__fixtures__/diffs.ts` so the
input is real `git diff` output. Cover, at minimum:

- the positive case, asserting the rule ID, severity, file, line and evidence;
- **every near-miss from your list**, asserting nothing fires;
- the marker inside a string literal and inside a comment;
- a non-test file, when the rule is meant to be test-only;
- the same edit inside a rename, so `renamed()` is exercised.

Coverage thresholds are per file in `vitest.config.ts` and may only go up.

### 6. Docs

Both, or `pnpm run check:llms` fails:

- The rules table in `README.md`. `packages/overlock/README.md` is generated
  from it — keep the two in step.
- `packages/overlock/llms.txt`, which is what an agent reads to decide how to
  react. Say what the repair is, not just what fired.

If the rule is graded in more than one way, explain both grades in the README
section on grading.

### 7. Changeset

```bash
pnpm changeset
```

Minor. Write the entry for someone reading the changelog: the edit it catches,
an example, and how it is graded.

### 8. Verify

```bash
pnpm run verify
pnpm run e2e
```

`verify` runs the same ordered list as CI. E2E drives the built binary against
real git repositories.
