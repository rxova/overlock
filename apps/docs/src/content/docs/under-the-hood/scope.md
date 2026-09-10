---
title: Scope
description: What overlock is for, and the four things it deliberately is not.
sidebar:
  order: 3
---

overlock reads a patch for a specific class of edit — the ones that make a test suite ask less — and reports them deterministically, so the result can be used as a gate.

That is the whole product. The rest of this page is what it is not, because a tool's boundaries are more useful to know than its features.

## It is not a linter

A linter reads a file and asks whether it is well-formed. Every edit overlock cares about produces a perfectly well-formed file: `it.skip` is a real function, `toBeTruthy()` is a real matcher, `statements: 40` is a valid number.

The signal is in the delta. Nothing that reads one version of a file can see it.

## It is not a code reviewer

It has no opinion about your architecture, your naming, your test design, or whether the change is a good idea. It does not read your pull request description to work out what you were trying to do.

Thirteen rules, one question each. A reviewer asks a hundred questions and knows things overlock never will.

## It does not run your tests

So it cannot tell you that the assertion you loosened would still pass, that the test you deleted was the only one covering a module, or that the suite is now faster because it does less.

It reads the patch. That is the entire input.

## It does not use a model to judge intent

Deliberately, and it is the design decision the rest of the tool follows from. [Why this exists](../learn/why.md) has the argument in full; the short version is that a gate has to be reproducible, and a claim you can check in ten seconds is worth more than a plausible sentence you cannot.

**A finding is a statement about the diff and nothing more.**

## What that buys you

The narrowness is not modesty, it is what makes the tool usable in the loop it was built for.

It is fast, because it reads text. It is offline, because there is nothing to call. It has zero runtime dependencies, so `npx overlock` on a cold cache is one small download and nobody has to think about supply chain to add it to a pipeline. It is deterministic, so a re-run means something and CI can gate on it. And it is checkable, so when it is wrong you can see that it is wrong in seconds rather than arguing with it.

## What it costs you

It will occasionally flag a change that was entirely correct, and the honest answer is that this is the price of the properties above. A tool that never fired on a correct change would need to understand intent, and understanding intent is exactly what it refuses to do.

[When the finding is wrong](../learn/false-positives.md) covers what to do then. The short version: check the evidence, and when the change was right, [suppress the finding by name with a reason](../reference/suppressions.md) — do not turn the rule off.

## Where it sits

Next to your linter, your type checker and your test run, not instead of any of them. It answers the one question none of the others do:

> Did this change make the tests pass by weakening the tests?
