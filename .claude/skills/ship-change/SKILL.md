---
name: ship-change
description: Take a change in this repository from working tree to merged pull request - changeset, verify gate, conventional commit, PR. Use when finishing a change here, preparing a commit or pull request, deciding whether a changeset is needed, or when CI or the pre-push gate fails.
---

# Shipping a change

## 1. Decide whether it needs a changeset

A change to anything under `packages/overlock` that a consumer could observe
needs one:

```bash
pnpm changeset
```

| Change                                        | Bump  |
| --------------------------------------------- | ----- |
| New rule, new flag, new config key            | minor |
| Rule fires on something it did not before     | minor |
| Narrowing a rule, fixing a message, a bug fix | patch |
| Changing what an existing rule ID means       | major |
| Removing or renaming a flag, config key or ID | major |
| CI, docs, tooling, dev-dependency bumps       | none  |

Write the entry for someone reading the changelog: what changed for them, with
an example, not a summary of the diff.

With no changeset, the `changeset present` job fails on the pull request. If the
change genuinely does not touch the published package, apply the
`skip-changeset` label rather than committing an empty changeset.

## 2. Run the gate

```bash
pnpm run verify
```

It is the same ordered list CI runs — lint, format, build, typecheck, unit
tests, package exports, `llms.txt`, dependency dedupe, audit — and it stops at
the first failure. The pre-push hook runs it, so a green verify means a green
push.

E2E is not in it. Run it separately when you touched `git.ts`, `cli.ts`,
`hook.ts`, `init.ts` or anything about how the binary is packaged:

```bash
pnpm run e2e
```

Common failures:

- **`llms.txt`** — a rule was added, renamed or removed and `llms.txt` was not
  updated. It must name every rule ID and every documented command.
- **`package exports`** — `publint` or `are-the-types-wrong`. Usually a `files`
  entry or an `exports` map that no longer matches what `tsup` emits.
- **`dependency dedupe`** — run `pnpm dedupe` and commit the lockfile.
- **`audit`** — a dev dependency has an advisory. The package has no runtime
  dependencies, so this is always dev tooling.
- **coverage thresholds** — raise coverage. Do not lower a threshold; overlock
  reports that as a `high` finding and this repository is not exempt from its
  own rules.

## 3. Commit

Conventional Commits, enforced by commitlint on the branch commits, the pushed
commit, and the pull request title — the title becomes the squash subject, so it
has to stand alone.

```
feat: watch the predicate that decides what an assertion ranges over
fix: stop the node 20 consumer probe asserting a fixed rule count
docs: describe the tenth rule
ci: gate merges on one always-reported check
chore(deps-dev): bump the dev-tooling group
```

Write the subject as what the change does to the tool, not what you did to the
files.

## 4. Open the pull request

Fill in `.github/PULL_REQUEST_TEMPLATE.md`. The title has to be a valid
Conventional Commit on its own; `pr-title.yml` checks it separately from the
main graph.

CI runs lint, format, typecheck and build; unit tests on Node 22 and 24; e2e on
Linux, macOS and Windows; a Node 20 consumer probe against the packed tarball;
audit and dedupe; the packaging contract; the changeset gate; and overlock
against the pull request's own patch. Branch protection requires the single
`all checks` context, which passes when every job passed or was deliberately
skipped.

If the dogfood job reports a finding on your own patch, fix the cause. If the
finding is genuinely wrong, that is a bug in a rule — open an issue for it and
say so in the pull request rather than suppressing it silently. A suppression
this patch added also stops the Stop hook once and is reported in the run.

## 5. Release

Automated. Merging to `main` opens or updates a `chore: version packages` pull
request; merging that one runs `verify` again and publishes to npm through
Trusted Publishing. There is no manual publish step and no npm token in
repository secrets.

The release job then pushes the tags, in two forms:

- **`overlock@<version>`**, one per release, written by `changeset publish`.
  Publishing creates these in the runner's clone but does not push them, so the
  workflow pushes them explicitly. Without that step a version reaches npm with
  nothing in the repository pointing at the commit it came from.
- **`v<major>`** — the moving major tag the GitHub Action is consumed under
  (`rxova/overlock@v0`). Actions convention is that consumers pin the major and
  it follows releases, so the job force-moves it to each released commit. The
  major is derived from the published version, so `v1` starts being written on
  its own at 1.0.0.

Both steps are gated on `steps.changesets.outputs.published == 'true'`, so a run
that only opens or updates the version pull request touches no tags.

After a release, check that the tags actually moved:

```bash
git ls-remote --tags origin
```

The set of `overlock@*` tags should match the versions on npm, and `v0` should
point at the newest release commit. If they have drifted, tag by hand against
the `chore: version packages` commit for that version, rather than leaving the
gap — and treat the drift as a bug in the release job.
