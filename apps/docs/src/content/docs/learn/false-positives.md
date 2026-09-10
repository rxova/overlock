---
title: When the finding is wrong
description: What to do when overlock flags a change that was correct, and why the answer is never to turn the rule off.
sidebar:
  order: 4
---

overlock reports what a patch did. Sometimes what the patch did was right, and the finding is still accurate.

```
✗ HIGH  src/pricing.test.ts:88  ASSERTION_NARROWED
     Assertion narrowed: the whole object was asserted; now one field is.
```

Maybe the other three fields moved to their own cases in the file below. Maybe they were removed from the type this week and asserting them was a compile error. The finding is _true_ — the assertion does cover less than it did — and it is also not a problem.

This page is about what to do next, in order of preference.

## First: read the evidence, not the rule name

Every finding carries the lines it is about and a fix hint. Rule names are compressed and can mislead — `TEST_AND_IMPL_TOGETHER` sounds like an accusation and is not one, it is a `low` note telling you which implementation change the other findings relate to.

The evidence is two lines. Read it before deciding it is wrong.

## Second: check whether the patch just looks bigger than it is

If you are staring at three hundred findings, you probably did not write three hundred weakenings. You renamed something.

```
overlock — 293 findings (293 low)  (origin/main)

  rename detected  warehouserouting -> routing  (607 files, 6 casings)
    293 findings consistent with it
    0 unexplained
```

overlock infers the substitution from the patch and collapses everything it accounts for, so the list you are asked to read is the part the rename does not explain. If you are seeing the unfolded version instead, the rename did not clear the recurrence bar — [renames and reformatting](../under-the-hood/renames-and-reformatting.md) explains what that means and what to do about it.

## Third: suppress the finding, by name, with a reason

This is the intended answer for a correct change that a rule flags.

```ts
// overlock-ignore ASSERTION_NARROWED -- the other fields moved to their own cases below
expect(row.lapsedAt).toBeNull();
```

Or, for a change too broad to annotate line by line, a trailer in the commit message or the pull request body:

```
Overlock-Allow: TEST_REMOVED src/api.test.ts -- the whole file moved to admin/
```

Both forms require the rule ID and a written reason. There is no wildcard. Every suppression is counted and reported, including on a run that is otherwise clean:

```console
$ overlock
✓ overlock: nothing weakened in this patch. (1 suppressed)
```

That count is the point. A suppression is not a way to make the finding go away; it is a way to move it from "unresolved" to "resolved, and here is why". The reason you wrote is the artefact — it is what a reviewer reads in six weeks when the test that was quarantined pending #412 is still quarantined and #412 is closed.

[Suppressions](../reference/suppressions.md) covers both forms in full, including how to name a finding that has no line to sit on.

## Fourth, and only for a rule you keep answering: grade it off

When you have suppressed the same rule with the same reason for the fourth time, the finding is not the problem — the rule's question does not apply to your repository. Say that once, in the [config file](../reference/configuration.md):

```json
{ "severity": { "TEST_AND_IMPL_TOGETHER": "off" } }
```

`off` is a grade like `high`, `medium` and `low`, and it is deliberately visible. The rule still runs, what it would have reported is dropped, and the count is printed in the verdict line on every run, clean ones included:

```console
$ overlock
✓ overlock: nothing weakened in this patch. (9 silenced by config)
```

That is the difference between a decision and a leak. Nine silenced findings you can see are a policy; nine you cannot are a gate that stopped being one. [Severity](severity.md) has the longer version, including why `off` is a judgement about one rule and `--fail-on none` is a judgement about all of them.

## Do not: reach for a regrade to get past one patch

`--severity ASSERTION_NARROWED=low` makes today's finding stop failing the run. It also makes every future one stop failing the run, in every patch, for everyone on the repository. If it went into your shell instead of a committed file, nothing anywhere records that a decision was made. Six months later the rule is down and no one alive knows why.

Regrade a rule when you have concluded something about your _codebase_ — "test files move constantly here, `TEST_REMOVED` at `high` is not informative for us" — not when you want to get past one patch. That is what [severity](severity.md) is for, and the config file is where it belongs, in a commit, with a message.

## If the rule is actually wrong

Some findings are not "true but fine". They are wrong: the assertion did not get weaker, the set did not get smaller, the file was not a test file.

That is a bug, and it is worth reporting. What a report needs is the patch shape — the before and after lines, the rule ID, and what you expected instead. The rules are deliberately mechanical, so a wrong finding almost always reduces to a pattern that needs a case added, which is a small fix.

Two known-mechanical edges, so you can recognise them:

- **Test-file detection is conventional.** A test file named `checks.ts` is not recognised as a test file, and nothing about it will be. `--test-glob` is the fix, not a bug report.
- **Case matching is a heuristic.** `TEST_REMOVED` matches a case by title, by title with the patch's own rename applied, and failing both by body. A case that was deleted and rewritten from scratch under a new name will read as deleted, because from the patch's point of view it was.

## The rule to take away

A finding you disagree with is a claim to check, not a setting to change. Check it, and when it is fine, say why in the patch — where the next person will find it.
