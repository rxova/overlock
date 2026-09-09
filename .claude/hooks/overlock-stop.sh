#!/usr/bin/env sh
#
# The Stop hook this repository gates its own turns with.
#
# It runs the overlock in the working tree rather than the last release, for the
# same reason the dogfood job passes `cli-path` to the action: a rule change
# should be gating the turn that writes it. What that buys in honesty it pays
# for in a dependency on a build, and `.claude/settings.json` used to name
# `packages/overlock/dist/cli.js` directly — so in a fresh clone or worktree,
# where nothing has been built yet, every turn ended in a MODULE_NOT_FOUND stack
# trace where a verdict belonged.
#
# Building here rather than requiring one is also what keeps the gate honest the
# rest of the time: a dist older than src gates the turn with yesterday's rules
# and says nothing about it. Turbo replays a warm build in under a second, so
# the common case — nothing changed since the last turn — costs almost nothing.

set -eu

root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
cli="$root/packages/overlock/dist/cli.js"

# stdin is the hook payload and belongs to the CLI alone; a build that read it
# would eat the very thing this hook is about to parse.
if ! (cd "$root" && pnpm run build >/dev/null 2>&1 </dev/null); then
  if [ ! -f "$cli" ]; then
    # Exit 0, deliberately. A hook that could not run has found nothing, and
    # failing every turn over an unbuilt tree would block work that has nothing
    # to do with overlock — an install that has not happened yet, most often.
    # Said out loud all the same: a gate that quietly stops gating is worse than
    # one that is quietly off, because the transcript still looks clean.
    echo "overlock: could not build, and there is no previous build to fall back on." >&2
    echo "overlock: this turn was NOT gated. Run \`pnpm install && pnpm run build\`." >&2
    exit 0
  fi

  # A build that failed over one that exists is worth saying, but the older
  # binary still answers the question this hook asks.
  echo "overlock: build failed; gating with the previous build, which may be stale." >&2
fi

# exec, so the CLI's exit code is the hook's: 2 is what blocks a turn, and a
# wrapper that swallowed it would disarm the gate it exists to run.
exec node "$cli" hook claude
