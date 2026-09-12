---
title: Configuration file
description: One committed file the CLI, the Stop hook and the GitHub Action all read.
sidebar:
  order: 2
---

`overlock.config.json` beside `package.json`, or an `overlock` key inside `package.json`:

```json
{
  "base": "origin/main",
  "baseMode": "fork-point",
  "failOn": "high",
  "failOnEmpty": false,
  "severity": { "TEST_REMOVED": "medium", "TEST_AND_IMPL_TOGETHER": "off" },
  "testGlob": ["\\.check\\.ts$"],
  "untracked": true,
  "exclude": [".basting", ".saidso"]
}
```

The CLI, the [Stop hook](../integrations/claude-code.md) and the [GitHub Action](../integrations/github-action.md) all read it, which is the point: the same patch resolves the same way on your machine, in the agent's turn, and on the pull request.

The alternative — settings in workflow inputs, settings in a hook command line, settings in your shell history — is how a gate that passes locally and a CI job that fails start disagreeing about the same diff, with no single file to look at.

## Settings

| Key           | Values                                        | Notes                                                                        |
| ------------- | --------------------------------------------- | ---------------------------------------------------------------------------- |
| `base`        | a git ref, or `"auto"`                        | Default `auto`. See [how it reads a patch](../learn/how-it-reads-a-patch.md) |
| `baseMode`    | `"fork-point"` \| `"direct"`                  | Default `fork-point`                                                         |
| `failOn`      | `"high"` \| `"medium"` \| `"low"` \| `"none"` | Default `high`                                                               |
| `failOnEmpty` | boolean                                       | Default `false`. Turn it on in CI                                            |
| `severity`    | `{ "<RULE_ID>": "<grade>" }`                  | `high` \| `medium` \| `low` \| `off`. Regrade individual rules               |
| `testGlob`    | array of regex strings                        | Extra test-file patterns                                                     |
| `untracked`   | boolean                                       | Default `true`                                                               |
| `exclude`     | array of repository paths                     | Left out of the patch, as `.overlock` is. See [below](#leaving-paths-out)    |

Note that `testGlob` takes **regular expressions**, not shell globs, and they are matched against the path. In JSON that means escaping backslashes: `"\\.check\\.ts$"`.

## Leaving paths out

`exclude` names paths overlock treats the way it already treats its own `.overlock` evidence directory: absent from the diff, the findings, the file count, the patch fingerprint, `auto` base selection and [captured snapshots](evaluation.md).

```json
{ "exclude": [".basting", ".saidso"] }
```

It exists for other tools that commit their evidence beside overlock's. Without it, a sibling tool's run log written on every turn changes the patch overlock reads on every turn — a new fingerprint each time — and a sibling that snapshots the working tree snapshots overlock's snapshots, which snapshot the sibling's, so both grow without end. Evidence committed on a branch would also land in the pull request's range.

Each entry is a literal prefix anchored at the repository root, whichever directory overlock runs from. A directory excludes everything under it, a file excludes that file, and `.basting` does not reach `.bastingx`. A leading `/` or `./` and a trailing `/` are dropped, so `/.basting`, `./.basting/` and `.basting` are the same entry: the leading `/` is a root anchor, as in `.gitignore`, not a filesystem path.

These stop the run with exit 2 rather than being read generously: anything but an array of non-empty strings; glob characters and escapes (`*`, `?`, `[`, `]`, `\`); pathspec magic (a leading `:`); `..`, `.` and empty segments; `~`, `//` and drive-letter paths; control characters. A pattern that matched more than it said would be a way to take files out of the patch that nobody decided to take out.

There is no flag. Where a repository keeps other tools' evidence is a fact about the repository, not a choice one invocation should make differently. Every [evaluation record](evaluation.md) carries the list in `settings.exclude`, so runs with different exclusions can be told apart.

Exclude evidence and generated output, nothing else: a test under an excluded path is never checked.

## Grading a rule off

`off` is a grade a rule can be given, alongside `high`, `medium` and `low`:

```json
{ "severity": { "TEST_AND_IMPL_TOGETHER": "off" } }
```

It belongs in `severity` rather than in `failOn` because the two answer different questions. `"failOn": "none"` is a judgement about every rule at once — nothing blocks. `"severity": { "X": "off" }` is a judgement about one rule: this repository has read enough of X's findings to say it does not have an answer here.

`TEST_AND_IMPL_TOGETHER` is the usual one. It fires on ordinary test-driven work by design, and a team that has decided that is fine should say so once in a committed file, not once per commit in an inline directive.

An `off` rule still runs. What it would have reported is dropped, counted, and printed in the verdict line — on clean runs too:

```console
$ overlock
✓ overlock: nothing weakened in this patch. (9 silenced by config)
```

The count is not decoration. An escape hatch nobody can see is how a gate quietly empties, and a green line resting on nine invisible findings is worse than having no gate. In the [JSON report](json-report.md) it is the `silenced` field.

`failOn` still takes `high | medium | low | none` and never `off`. No finding carries severity `off`; `counts` keeps its three keys. See [severity](../learn/severity.md) for the difference between regrading, grading off and suppressing.

## Where it looks

The nearest declaration at or above the working directory wins. In a monorepo, a package carrying its own `overlock.config.json` gets its own settings, and everything else falls back to the root.

`--config <file>` points at one directly. `--no-config` skips the search entirely, which is what you want in a test or when reproducing someone else's run.

A flag always overrides the file. The repeatable options — `--severity` and `--test-glob` — override it wholesale rather than merging: passing one `--severity` means that list and only that list, because a policy half in a file and half on a command line is one nobody has written down.

## An unknown key is an error

An unrecognised setting or an invalid value stops the run with **exit 2**, rather than being ignored.

A config file that silently drops the key you misspelled is the worst possible behaviour for a gate. You would have `"failOnn": "medium"` in a committed file, a green pipeline, and a shared belief that the threshold is `medium` when it is `high` — or, worse, the other way round.

## `overlock config` tells you what won

```console
$ overlock config
overlock: /repo/overlock.config.json
  base = "origin/main"  (config)
  baseMode = "fork-point"  (default)
  failOn = "low"  (flag)
```

Each value with its source. This is the first command to run when the hook blocks something CI let through, or the other way round.

## What does not go here

Suppressions. A finding you have decided is fine belongs in the patch that caused it — an inline directive or a commit trailer, with a reason — not in a config file where it silently applies to every future patch. See [suppressions](suppressions.md).
