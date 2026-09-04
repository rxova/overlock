---
'overlock': minor
---

Read `--base <ref>` as a fork point, and say what each run examined

`--base main` ran `git diff main`, which compares main's tip to this working
tree. The moment main moved ahead, every file main gained read as a deletion
here — and a test file among them was reported as `TEST_REMOVED`, at HIGH, on a
branch that never touched it. It now resolves to the fork point, `main...HEAD`:
what this branch did since it left main. `--base-mode direct` asks for the old,
literal comparison.

`check` now defaults to `auto` like the hook and the MCP tool, instead of
looking only at the working tree. A pre-push gate runs when the commits exist
and nothing is uncommitted, which was precisely when the old default had least
to look at, and it reported that as clean.

Every verdict now names its scope — `83 files, 3 commits, against 492b7ad` — on
clean runs as well as findings, and a range that resolved to nothing is reported
as `nothing to examine` rather than as a pass. `--fail-on-empty` makes that
exit 1. `--explain-base` prints how the base was chosen, in order.

`Report` gains an optional `scope` field, `{ files, commits }`, set on any run
against a repository.
