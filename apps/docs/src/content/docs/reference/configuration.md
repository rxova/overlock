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
  "severity": { "TEST_REMOVED": "medium" },
  "testGlob": ["\\.check\\.ts$"],
  "untracked": true
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
| `severity`    | `{ "<RULE_ID>": "<grade>" }`                  | Regrade individual rules                                                     |
| `testGlob`    | array of regex strings                        | Extra test-file patterns                                                     |
| `untracked`   | boolean                                       | Default `true`                                                               |

Note that `testGlob` takes **regular expressions**, not shell globs, and they are matched against the path. In JSON that means escaping backslashes: `"\\.check\\.ts$"`.

## Where it looks

The nearest declaration at or above the working directory wins. In a monorepo, a package carrying its own `overlock.config.json` gets its own settings, and everything else falls back to the root.

`--config <file>` points at one directly. `--no-config` skips the search entirely, which is what you want in a test or when reproducing someone else's run.

A flag always overrides the file.

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
