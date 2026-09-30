# Contributing

Thanks for taking the time. Bug reports, rule false positives and false
negatives, and documentation fixes are all welcome.

## Before you start

- **Bugs and false positives**: open an issue with the diff (or a reduced
  version of it) that produced the wrong result. A patch that reproduces the
  problem is more useful than a description of it.
- **New rules or flags**: open an issue first. A rule that fires wrongly is worse
  than no rule, so new rules are discussed before they are written.
- **Small fixes**: typos, broken links and obvious mistakes can go straight to a
  pull request.

## Development setup

The repository is a pnpm workspace driven by Turborepo.

```bash
corepack enable
pnpm install
```

The toolchain needs Node.js 22.13 or newer (pnpm 12 requires it). The published
package itself supports Node.js 20.11 and up, which CI verifies by packing the
tarball and running it under Node 20.

```bash
pnpm exec turbo run build        # tsdown, ESM, with .d.ts
pnpm test                        # unit suite with coverage thresholds
pnpm run e2e                     # end-to-end against real git repositories
pnpm lint
pnpm run format:check
pnpm exec turbo run typecheck
```

`pnpm run verify` runs the same ordered list CI runs and is what the pre-push
hook calls. Run it before pushing; a green verify means a green pipeline. E2E is
not part of it and runs as its own CI job. The runner is `rxova-repo-config
verify` from `@rxova/repo-config`; the steps are listed in
`package.json#repoConfig.verify.steps`.

To run a single test file:

```bash
pnpm --filter overlock exec vitest run src/rules/skip.test.ts
```

## Shared setup

The repository runs on the rxova org's shared tooling, so most of what would
otherwise be local configuration is a dependency:

- `@rxova/repo-config` provides the verify gate, the changeset gate,
  `check-llms`, `check-exports`, `pack-smoke` and the ESLint, Prettier,
  lint-staged, commitlint, changelog, tsconfig, tsdown, Vitest and Knip presets.
  The configuration files at the root are a line or two over those presets.
- `@rxova/docs-kit` builds the docs site's `.md` twins, `llms.txt` and
  `llms-full.txt`, and checks them after the build.
- The CI jobs, the PR title check, the docs publish and the release are
  reusable workflows and actions from [rxova/shared](https://github.com/rxova/shared),
  and `.github/renovate.json5` extends its org preset.

A change to how the repository is checked usually belongs in rxova/shared.
What stays here is specific to overlock: the e2e matrix, the Node 20 consumer
probe in `scripts/`, the jobs that run overlock on its own pull requests, and
the release steps that tag the GitHub Action.

## Repository layout

See [AGENTS.md](AGENTS.md) for the file-by-file layout and the invariants a
change must not break — the zero-runtime-dependency rule, the frozen rule IDs,
coverage thresholds that only go up, and how untracked files and suppressions
are handled.

## Tests

- Tests are colocated as `*.test.ts` beside the code they cover.
- Coverage thresholds are enforced per file in `vitest.config.ts` and may be
  raised, never lowered.
- Diff fixtures are real `git diff` output rather than hand-shaped objects, so a
  parser bug and a rule bug cannot cancel each other out.
- A new rule needs tests for the cases it should fire on **and** the near-misses
  it must not fire on. The second set is the one that keeps the gate usable.

## Commits

Commits follow [Conventional Commits](https://www.conventionalcommits.org).
Commitlint checks the branch commits, the pushed commit, and the pull request
title — the title becomes the squash subject, so it has to be valid on its own.

```
feat: watch the predicate that decides what an assertion ranges over
fix: stop the node 20 consumer probe asserting a fixed rule count
docs: describe the tenth rule
chore(deps-dev): bump the dev-tooling group
```

Husky installs a pre-commit hook (lint-staged, then typecheck and unit tests for
whatever the commit touched) and a pre-push hook (`pnpm run verify`).

## Changesets

A change to the published package needs a changeset:

```bash
pnpm changeset
```

Pick the bump and write the entry for someone reading the changelog, not for
someone reading the diff. Adding a rule is a **minor**; changing what an
existing rule ID means is a **major**.

Repository-only changes — CI, docs, tooling, dependency bumps — do not need one.
The `skip-changeset` label answers the changeset gate for those.

## Pull requests

- One concern per pull request.
- Fill in the pull request template.
- CI must be green. It runs lint, format, typecheck, build, unit tests on Node
  22 and 24, e2e on Linux, macOS and Windows, a Node 20 consumer probe, a
  dependency audit, the packaging contract, and overlock against the pull
  request's own patch.
- If overlock reports a finding on your own patch, fix the cause. If the finding
  is genuinely wrong, that is a bug worth its own issue — say so in the pull
  request rather than suppressing it silently.

## Releases

Releases are automated with Changesets, through the shared release workflow
that `.github/workflows/release.yml` calls once CI is green on `main`. Merging
to `main` opens or updates a version pull request; merging that publishes to npm
with trusted publishing. Follow-up jobs in the same file then tag and release
the GitHub Action (`vX.Y.Z`, and the moving `v0`).

## Code of conduct

Participation is governed by the [Code of Conduct](CODE_OF_CONDUCT.md).

## License

By contributing you agree that your contributions are licensed under the
[MIT License](LICENSE).
