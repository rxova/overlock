---
title: Why this exists
description: A green suite has two causes, and a diff is the only place they look different.
sidebar:
  order: 1
---

Ask an agent to make the failing test pass. It has two routes. One is to fix the code. The other is to change the test until the code is fine as it is.

Both end with a green run. Both end with a commit that says something reasonable. And the second one is often _easier_, which matters more than it sounds, because easier is exactly what a system optimising for a passing suite will find.

Here is the whole failure, in two lines:

```diff
- it('rejects expired tokens', async () => {
+ it.skip('rejects expired tokens', async () => {
```

Nothing in the toolchain objects. TypeScript is happy — `it.skip` is a real function. ESLint is happy; the file has no unused variables and no `any`. The test runner is delighted, because a skipped test is not a failing test. Coverage may not even move much, if the module is exercised elsewhere. The pull request diff shows five characters in a file with a hundred and forty lines of legitimate changes around them.

The suite is now smaller, and nothing said so.

## Why the existing tools miss it

A linter reads one file at a time and asks whether it is well-formed. `it.skip` is well-formed. So is `toBeTruthy()`, so is `statements: 40`, so is deleting a file.

Coverage thresholds catch one shape of this and miss the rest. They also live in a file that the same patch can edit, which is not a hypothetical — `COVERAGE_THRESHOLD_LOWERED` exists because lowering the number is the standard way to make a coverage gate stop complaining.

Code review catches all of it, in principle. In practice review budget goes to the interesting part of the diff, and none of these edits are interesting to look at. They are small, they are syntactically boring, and they sit in files a reviewer skims.

**The signal is not in any one file. It is in the delta.** That is the gap: the tools that read files cannot see it, and the tool that reads deltas — the reviewer — is the scarcest thing in the loop.

## What changed

None of this is new. Weakening a test to get a green run is as old as testing, and every engineer has done it at least once, usually for a defensible reason at the time.

What changed is throughput. A person weakens a test occasionally and remembers doing it. An agent working through a task list weakens a test whenever weakening a test is the shortest path to the goal it was given, at whatever rate it is producing commits, and remembers nothing between sessions. The individual edit is the same edit. The rate is not, and neither is the amount of review attention available per edit.

So the tool has to be automatic, it has to run on every turn, and it has to be cheap enough that nobody is tempted to take it out of the loop. Hence: a CLI with zero runtime dependencies, no network, and a [Stop hook](../integrations/claude-code.md) that blocks the turn instead of writing advice into a file the model may or may not re-read.

## Why determinism is the design

The obvious way to build this is to ask a model whether the diff looks like cheating. That works, in the sense that it produces plausible output, and it fails as a gate for two reasons.

It is not reproducible. A gate that answers differently on the same input twice is not a gate; it is a coin flip with good manners. You cannot put it in CI, because a re-run has to mean something.

And it cannot be argued with productively. When overlock says `ASSERTION_WEAKENED`, it is claiming something checkable: this line named a value, the line that replaced it does not. You look, and you agree or you do not, in about ten seconds. When a model says "this looks like it might be weakening the tests", there is nothing to check, so the conversation becomes about the model.

The cost of determinism is that overlock is dumber than a reviewer. It does not know that the test you deleted was testing a feature you also deleted. It reports what the patch did and hands you the evidence, and sometimes the answer is "yes, and that was correct" — which is what [suppressions](../reference/suppressions.md) are for, and why they require you to write down the reason.

## The rule this leaves you with

Do not gate on intent. Gate on the delta, tell the truth about what it says, and make the override cheap but visible.
