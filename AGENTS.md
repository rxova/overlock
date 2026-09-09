# AGENTS.md

Guidance for coding agents and contributors working in this repository. It
applies to the whole tree; `packages/overlock` is the published package.

## What this is

`overlock` reads a git diff and reports test-integrity findings. It is a
deterministic CLI: no LLM calls, no network calls, no telemetry, and **zero
runtime dependencies**.

The zero-dependency rule is a product constraint, not an accident. Something
runs this on every agent turn, so each runtime dependency is a download paid on
every invocation and a supply-chain surface on a tool whose job is trust. Do not
add one. Dev dependencies are fine.

## Layout

| Path                                    | What it holds                                                           |
| --------------------------------------- | ----------------------------------------------------------------------- |
| `packages/overlock/src/cli.ts`          | Argument parsing, usage text, exit codes                                |
| `packages/overlock/src/run.ts`          | Acquires the diff, applies the rules, records the run                   |
| `packages/overlock/src/diff.ts`         | Unified diff parser, hand-written for the zero-dependency rule          |
| `packages/overlock/src/git.ts`          | Range resolution and every `git` invocation                             |
| `packages/overlock/src/rules/`          | The eleven rules. Each is pure: `DiffFile[]` in, `Finding[]` out        |
| `packages/overlock/src/rules/cases.ts`  | The diff grouped by test case, which several rules read                 |
| `packages/overlock/src/substitution.ts` | Rename and reformat inference                                           |
| `packages/overlock/src/report.ts`       | Three views: full, `--json`, `compact`                                  |
| `packages/overlock/src/hook.ts`         | The Claude Code `Stop` hook protocol                                    |
| `packages/overlock/src/mcp.ts`          | MCP over stdio, spoken directly                                         |
| `packages/overlock/src/types.ts`        | The wire contract, including the frozen rule IDs                        |
| `packages/overlock/llms.txt`            | What an agent reads to decide how to use the tool                       |
| `packages/tooling/`                     | Repo scripts: pack smoke test, pre-push gate, changeset and scope gates |
| `action.yml`                            | The GitHub Action, a composite action at the repo root                  |

## Commands

```bash
pnpm install                     # pnpm 11, Node >= 22.13 for the toolchain
pnpm exec turbo run build        # tsup, ESM, with .d.ts
pnpm test                        # unit suite with per-file coverage thresholds
pnpm run e2e                     # spawns real git repositories; slow
pnpm lint                        # eslint
pnpm run format:check            # prettier
pnpm exec turbo run typecheck    # tsc --noEmit
pnpm run verify                  # the pre-push gate: the same ordered list CI runs
```

Run `pnpm run verify` before you finish. A green verify means a green pipeline.
E2E is kept out of it because it spawns real git repositories and is slow enough
that including it would encourage `--no-verify`.

To exercise one file: `pnpm --filter overlock exec vitest run src/rules/skip.test.ts`.

## Invariants

**The JSON schema is the API.** Rule IDs in `src/types.ts` are frozen. Adding a
rule is a minor release; changing what an existing ID means is a breaking one.
The same applies to `llms.txt`, which `pnpm run check:llms` holds to the rule
registry.

**Precision over recall.** A gate that blocks wrongly is a gate that gets
uninstalled. Put a rule at `high` only when a false positive would be
surprising; otherwise `medium`.

**Coverage thresholds go up, never down.** They are enforced per file in
`vitest.config.ts`. `overlock` reports lowering them as a `high` finding, and
this repository is not exempt from its own rule.

**Untracked files are part of the patch.** `git diff HEAD` says nothing about a
file git has never seen, so an agent creating an already-skipped test file would
otherwise pass clean. `src/git.ts` synthesises additions for them. Do not
replace this with `git add -N`: that writes to the index of a repository this
tool promises only to read, and the e2e suite asserts the index is untouched.

**Suppressions require a reason.** `overlock-ignore RULE_ID -- reason` silences
one rule on one line. No reason, no unknown rule, no wildcard; the count of
suppressed findings is reported and logged. Making the escape hatch easier to
use makes the gate meaningless.

**Rules are pure.** A rule takes `DiffFile[]` and returns `Finding[]`. It does
not read the filesystem, shell out, or depend on the order the other rules ran.

## Conventions

- TypeScript, ESM only, `strict`. No `any` without a comment saying why.
- Comments explain _why_, not _what_. If a line's purpose is obvious from the
  code, it does not need a comment.
- Prettier settings live in `.prettierrc`; do not hand-format around them.
- Tests are colocated as `*.test.ts` next to the code they cover. Diff fixtures
  in `src/__fixtures__/` are real `git diff` output, not hand-shaped objects, so
  that a parser bug and a rule bug cannot cancel out.
- Examples in docs and fixtures use neutral placeholder names.

## Making a change

1. Write or update the test first; the suite is the specification.
2. Keep the change scoped. A rule change should not also reshape the report.
3. Run `pnpm run verify`.
4. A change to the published package needs a changeset: `pnpm changeset`.
   Repository-only changes (CI, docs, tooling) do not; the `skip-changeset`
   label answers the gate for those.
5. Commit with Conventional Commits. Commitlint checks the branch commits, the
   pushed commit, and the pull request title, since the title becomes the squash
   subject.

## Adding a rule

See [`.claude/skills/add-rule/SKILL.md`](.claude/skills/add-rule/SKILL.md) for
the full checklist. In short: append the ID to `RULE_IDS`, implement the rule as
a pure function under `src/rules/`, register it in `src/rules/index.ts`, add
tests including the false-positive cases you rejected, document it in the README
table and in `llms.txt`, and write a minor changeset.

## The hook on this repository

`.claude/settings.json` runs
[`.claude/hooks/overlock-stop.sh`](.claude/hooks/overlock-stop.sh), which runs
the **locally built** binary rather than `npx -y overlock`, which is what
`overlock init claude` writes everywhere else. This repository is the package,
so it gates itself on the code in the working tree rather than on the last
published release.

The wrapper builds before it runs, so there is nothing to do first: a fresh
clone or worktree gates its first turn, and a rule you changed this turn is the
rule that gates it. Turbo replays a warm build in under a second.

If the build cannot run at all — no `pnpm install` yet — the hook says on stderr
that the turn was **not** gated and exits 0 rather than failing every turn over
an unbuilt tree. That is a hole, and it is loud on purpose: a gate that stops
gating quietly is worse than one that is visibly off.
