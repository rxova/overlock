---
title: Suppressing findings
description: Two forms, both requiring a rule ID and a written reason, both counted on the record.
sidebar:
  order: 3
---

Sometimes the finding is accurate and the change was right. Say so, by name, with a reason.

Both forms require a named rule and a written reason. **There is no wildcard.** And every suppression is counted and reported, including on an otherwise clean run:

```console
$ overlock
✓ overlock: nothing weakened in this patch. (1 suppressed)
```

That count is the design. A suppression does not make the finding disappear; it moves it from "unresolved" to "resolved, and here is why". The reason you wrote is the artefact — it is what somebody reads in six weeks when the test quarantined pending #412 is still quarantined and #412 is closed.

## Inline directive

On the offending line, or on the line directly above it:

```ts
// overlock-ignore TEST_SKIPPED_ADDED -- quarantined pending #412
it.skip('rejects expired tokens', () => {
```

The rules it enforces:

- **A directive with no reason silences nothing.** `// overlock-ignore TEST_SKIPPED_ADDED` on its own is not a suppression.
- **An unknown rule ID silences nothing.** A typo fails loudly rather than leaving you with a finding and a comment that claims it is handled.
- **A directive inside a string literal is ignored**, so a test whose fixture contains the text of a directive does not accidentally silence its own file.
- One directive covers one rule, on one line, in one file.

## Naming a path, for findings with no line

Some findings have nowhere to sit. A deleted test file is reported against a path that no longer has a line 1. Name the path instead, from any line the patch still has:

```ts
// overlock-ignore TEST_REMOVED src/api.test.ts -- module deleted; cases re-homed here
```

A directive naming a path covers only the findings in that path **that carry no line of their own**. It cannot blanket-silence a rule across a file, which is exactly the thing a path-based directive would otherwise become.

## The self-suppression stop

**A directive added by the patch itself stops the [Stop hook](../integrations/claude-code.md) once.** It still silences the finding, and the hook stops and quotes the claim back:

```
overlock: this patch silenced 1 of its own findings.

! src/auth.test.ts:42 TEST_SKIPPED_ADDED
   overlock-ignore ... -- flaky

If that is right, say so and finish. If not, fix the cause.
```

An agent writing its own permission slip is the loop the whole tool exists to interrupt, so the claim gets in front of a human once. The hook never stops twice for the same directive, so the next turn continues either way. A directive that was already in the tree passes without comment.

## Commit or pull request trailer

For a change too broad to annotate line by line:

```
Overlock-Allow: TEST_AND_IMPL_TOGETHER -- rename only, no behaviour changed
```

What it names can be as narrow as a single finding:

```
Overlock-Allow: TEST_REMOVED src/api.test.ts -- the whole file moved
Overlock-Allow: TEST_REMOVED src/api.test.ts:42 -- one finding, by line
Overlock-Allow: TEST_REMOVED "src/api.test.ts::rejects expired tokens" -- ported to tokens.test.ts
```

The quoted form names a **case** rather than a line, which survives lines being added above it — the right choice when the allowance needs to outlive the next edit to the file.

In CI, the pull request body is not part of any commit message; `--allow-file pr-body.txt` reads trailers from a file so a workflow can pass it in.

## A trailer that matches nothing is reported

```
  ! allowed nothing: TEST_REMOVED src/api.test.ts::rejects expired tokens -- ported to tokens.test.ts
    The finding it names is not in this patch.
```

Rather than being silently ignored. An allowance that does not apply is either a typo or a belief about the patch that turned out to be wrong, and both are worth knowing about — particularly the second, where somebody thought they were permitting one thing and permitted nothing at all.

## The two forms complement each other

At `Stop` time a trailer covers what the agent **committed** during the session. Work still sitting in the working tree has no commit message to read.

So: trailers for what is committed and broad, inline directives for what is uncommitted and specific. The trailer cannot cover a file the agent has not committed yet, which is why it does not replace the inline form.

## What a good reason looks like

Bad: `-- flaky`. Bad: `-- not relevant`. Bad: `-- see PR`.

Good: `-- quarantined pending #412`, `-- the other fields moved to their own cases below`, `-- e2e package split out; 95 was the combined number`.

The test is whether the sentence would let a stranger decide, in six months, whether the suppression is still correct. Nothing enforces this — overlock only checks that a reason exists. That part is on you.
