---
title: TEST_SKIPPED_ADDED
description: A test stopped running — .skip, xit, .todo, @pytest.mark.skip, #[ignore] — or .only silenced everything else.
sidebar:
  order: 3
---

**Severity: `high`.**

Five characters, and a test is gone:

```diff
- it('rejects expired tokens', async () => {
+ it.skip('rejects expired tokens', async () => {
```

```
✗ HIGH  src/auth.test.ts:42  TEST_SKIPPED_ADDED
     .skip added — this test no longer runs.
     + it.skip('rejects expired tokens', async () => {
     -> Make the test pass, or delete it deliberately and say why.
```

This is the rule that most often catches an agent, and the fix hint is the whole position: **make the test pass, or delete it deliberately and say why.** A skipped test is the worst of both — it does not protect anything, and it looks like it does.

## What counts as skipped

Across the languages overlock recognises:

- **JavaScript / TypeScript** — `.skip`, `.todo`, `xit`, `xdescribe`, `xtest`, `pending()`
- **Python** — `@pytest.mark.skip`, `@pytest.mark.xfail`, `@skip`, `@skipIf`, `@skipUnless`, `pytest.skip()`
- **Go** — `t.Skip()`
- **Rust** — `#[ignore]`
- **Java / Kotlin** — `@Disabled`, `@Ignore`
- **C# / F#** — `[Ignore]`, `[Skip]`

A directive split across lines is rejoined before matching, so this still fires:

```js
it
  .skip('rejects expired tokens', async () => {
```

Commented-out code does not fire. Rust attributes are the exception the matcher knows about — `#[ignore]` starts with `#`, which is a comment character in several of these languages, so `#[` and `#![` are excluded from the comment check rather than being swallowed by it.

## `.only` is the same rule pointing the other way

```
✗ HIGH  src/auth.test.ts:42  TEST_SKIPPED_ADDED
     .only added — this silences every other test in the file.
     -> Remove .only so the rest of the file runs again.
```

`.only`, `fit` and `fdescribe` do not skip the test they are on. They skip _every other test in the file_, which is a much larger edit than it looks and is almost always a debugging leftover that got committed. Same rule ID, different message and different hint, because the fix is different: you remove it rather than replacing it.

## What does not fire

A test that was already skipped before the patch. The rule is about the patch adding a skip, not about the repository containing skipped tests — a quarantined suite you inherited does not produce a finding every time you touch the file.

Deleting a skipped test does not fire this rule either. It fires [`TEST_REMOVED`](test-removed.md), which is the accurate description.

## Suppressing it

```ts
// overlock-ignore TEST_SKIPPED_ADDED -- quarantined pending #412
it.skip('rejects expired tokens', () => {
```

A suppression that the patch itself added **stops the [Stop hook](../integrations/claude-code.md) once**, even though it silences the finding. The hook quotes the claim back:

```
overlock: this patch silenced 1 of its own findings.

! src/auth.test.ts:42 TEST_SKIPPED_ADDED
   overlock-ignore ... -- flaky

If that is right, say so and finish. If not, fix the cause.
```

This is the one case where the tool is deliberately in your way for a second: an agent writing its own permission slip is exactly the loop this rule exists to interrupt. It stops once, never twice for the same directive, so the next turn continues.
