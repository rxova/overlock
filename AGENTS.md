# Working in this repository

`patchfinder` reads a git diff and reports test-integrity findings. It is a
deterministic CLI with **zero runtime dependencies** — that is a product
constraint, not an accident. Something runs this on every agent turn, so a
runtime dependency costs a network round trip each time. Do not add one.

## Layout

- `packages/patchfinder` — the published package.
  - `src/diff.ts` — unified diff parser, hand-written for the same reason.
  - `src/rules/` — the nine rules. Each is pure: `DiffFile[]` in, `Finding[]` out.
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
`npx -y patchfinder`, which is what `patchfinder init claude` writes everywhere
else. This repository is the package, so it gates itself on the code in the
working tree, not on the last published release. Run `pnpm exec turbo run build`
once and the hook is live; before that it exits non-zero without blocking, which
is the correct behaviour for a hook that cannot run.
