---
name: triage-finding
description: Turn a reported overlock false positive or false negative into a failing test and a fix. Use when a rule fired on a change that weakened nothing, when a real weakening went unreported, or when investigating an issue about rule accuracy.
---

# Triaging a finding

Rule accuracy is what this tool is judged on. A false positive gets it
uninstalled; a false negative makes a clean run a claim nobody checked. Both are
bugs, and both are reproduced the same way: overlock is a pure function of the
patch, so the patch is the whole reproduction.

## 1. Get the patch

If the report has a diff, use it. If it has a repository and a commit,
reconstruct it:

```bash
git diff <base>...<head> > /tmp/report.diff
```

Reduce it to the smallest diff that still shows the behaviour — one file, one
hunk if possible. Confirm the reduced patch still reproduces before going
further:

```bash
node packages/overlock/dist/cli.js check --json --no-ledger
```

## 2. Establish which stage is wrong

Run the reduced patch through the layers in order. The failure is in exactly one
of them, and fixing the wrong one is how a rule accumulates special cases.

| Symptom                                        | Suspect                                               |
| ---------------------------------------------- | ----------------------------------------------------- |
| The wrong lines, paths or hunks reach the rule | `src/diff.ts`                                         |
| The patch is not the one you expected          | `src/git.ts` — try `--explain-base`                   |
| The right lines reach it, wrong verdict        | the rule in `src/rules/`                              |
| Removal paired with an unrelated addition      | run splitting in `src/diff.ts`, or the rule's pairing |
| Fires on a rename that explains itself         | `src/substitution.ts`                                 |
| Severity is defensible but the message is not  | the rule's `message` and `fix_hint`                   |

## 3. Write the test first

Add it to the colocated `*.test.ts` for whichever stage you identified, using
the fixtures in `src/__fixtures__/diffs.ts` so the input stays real `git diff`
output. It must fail for the reported reason before you touch the
implementation.

For a false positive, the test asserts the rule stays quiet. For a false
negative, it asserts the finding, its severity and its evidence.

Add the neighbouring cases too. A false positive is usually one member of a
family — if `toBeNull()` was misread as an existence check, then
`toBeUndefined()` and `toBe(false)` belong in the same test.

## 4. Fix it

Narrow the rule rather than special-casing the report. If the fix is a list of
exceptions, the rule is matching on the wrong thing.

Ask what the fix costs in the other direction: a change that quiets a false
positive by ignoring a shape will also ignore a real weakening in that shape.
Say which trade you made in the changeset.

If the honest answer is that a diff cannot distinguish the two cases, the fix is
to regrade — `high` to `medium` — not to invent a heuristic that will be wrong
in a different way.

## 5. Check the rest of the suite still agrees

```bash
pnpm run verify
pnpm run e2e
```

If another test had to change to accommodate the fix, read that test carefully:
it was asserting the old behaviour on purpose, and the change may be a
regression rather than an update. Never weaken an existing assertion to make a
fix land — this repository is gated by its own tool.

## 6. Changeset

```bash
pnpm changeset
```

Patch for a fix that narrows a rule; minor if the rule now fires on something it
did not before. Name the shape that was wrong and the shape it is now, so
someone hitting the old behaviour recognises it in the changelog.
