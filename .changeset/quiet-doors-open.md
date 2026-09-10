---
'overlock': patch
---

`SUITE_SCOPE_NARROWED` no longer fires on a config file the patch creates.

Read line by line, an added file is all gains and no losses — which is exactly
the shape of an exclude list that grew. Every new package that arrived with a
`vitest.config.ts` therefore read as a narrowed suite, at `high`, and blocked
the merge.

The trade: a config file that is _born_ narrow is no longer reported. There is
no prior set to compare it against, so the alternative is firing on every new
package, and a gate that does that is one people switch off. A file that already
existed still fires, including when it gains an `exclude` key it never had.
