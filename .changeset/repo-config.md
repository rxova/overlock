---
'overlock': minor
---

Read settings from the repository, so the CLI, the hook and the action agree

The CLI, the GitHub action and the Stop hook each arrived at their own base,
their own fail-on and their own severity grades. The same patch could pass
locally and block in CI with nothing to point at, and anyone wanting the three
to agree had to carry the policy between them in a wrapper script — which is
where the drift lives, not where it is fixed.

`overlock.config.json` beside your `package.json`, or an `overlock` key inside
it, is now read by all of them: `base`, `baseMode`, `failOn`, `failOnEmpty`,
`severity`, `testGlob`, `untracked`. The nearest declaration at or above the
working directory applies, so a package in a monorepo can have its own answer.
A flag always wins over the file. `--config <file>` points at one directly and
`--no-config` ignores the search.

An unknown setting or a bad value stops the run with exit 2 rather than being
skipped, because a `failon` typo that silently did nothing is the same failure
in miniature.

`overlock config` prints the settings in force and whether each came from a
flag, the file or the built-in default. `Report` gains `fail_on`, the threshold
the run actually applied, so a renderer names the same one the run used — the
action's pull request comment now reads it from there.

The action no longer passes `--base auto` or `--fail-on high` when its inputs
are unset, so the repository's own configuration is what answers. It gains a
`fail-on` output carrying the threshold that was applied, logs the settings in
force in a collapsed group, and prints `--explain-base` alongside the readable
report.
