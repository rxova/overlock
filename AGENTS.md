# Working in this repository

`overlock` reads a git diff and reports test-integrity findings. It is a
deterministic CLI with **zero runtime dependencies** — that is a product
constraint, not an accident. Something runs this on every agent turn, so a
runtime dependency costs a network round trip each time. Do not add one.

## Layout

- `packages/overlock` — the published package.
  - `src/diff.ts` — unified diff parser, hand-written for the same reason.
  - `src/rules/` — the eleven rules. Each is pure: `DiffFile[]` in, `Finding[]` out.
  - `src/rules/cases.ts` — the diff grouped by test case, which three of them read.
  - `src/report.ts` — three views. `compact` is the one that reaches a phone.
  - `src/hook.ts` — the Claude Code Stop protocol.
- `packages/tooling` — repo scripts (pack smoke test, pre-push gate, changeset gate).


## Rules that matter here

**The JSON schema is the API.** Rule IDs in `src/types.ts` are frozen. Adding a
rule is a minor release; changing what an existing ID means is breaking.

**Precision beats recall.** A gate that blocks wrongly gets uninstalled within
one session. Only put a rule at `high` when a false positive would be genuinely
surprising. When in doubt, `medium`.

**Do not weaken this repository's own tests.** Coverage thresholds in
`vitest.config.ts` go up, never down. If a change cannot meet them, the change
is what needs work.

## Before you finish

Run `pnpm run verify`. It is the same ordered list CI runs, so a green verify
means a green pipeline. E2E is separate (`pnpm run e2e`) because it spawns real
git repositories and is slow enough that putting it in the pre-push gate would
train people to use `--no-verify`.

## The hook on this repository

`.claude/settings.json` runs the **locally built** binary rather than
`npx -y overlock`, which is what `overlock init claude` writes everywhere
else. This repository is the package, so it gates itself on the code in the
working tree, not on the last published release. Run `pnpm exec turbo run build`
once and the hook is live; before that it exits non-zero without blocking, which
is the correct behaviour for a hook that cannot run.

## Two things not to undo

**Untracked files are part of the patch.** `git diff HEAD` says nothing about a
file git has never seen, so an agent creating an already-skipped test file used
to pass clean. `src/git.ts` synthesises additions for them. Do not "simplify"
this to `git add -N`: that writes to the index of a repository this tool
promises only to read, and the e2e suite asserts the index is untouched.

**Suppressions require a reason.** `overlock-ignore RULE_ID -- reason` silences
one rule on one line. No reason, no unknown rule, no wildcard — and the count of
suppressed findings is reported and logged. Making the hatch easier is not an
improvement; it is how the gate ends up passing everything.
