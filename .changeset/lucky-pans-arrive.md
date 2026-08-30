---
'overlock': minor
---

First release. `overlock` reads the diff a coding agent just made and reports
the edits that buy a green check rather than earn one: skipped tests, removed or
weakened assertions, edited expected values, lowered coverage thresholds,
snapshots regenerated alongside the code they cover.

- `overlock check` with `--json`, `--compact`, `--staged`, `--base`, `--fail-on`
  and `--test-glob`.
- `overlock init claude` installs a **committed** `.claude/settings.json` Stop
  hook, which is what makes it work in cloud and mobile sessions — those do not
  read `~/.claude/settings.json`. The hook blocks on HIGH findings and never
  blocks twice, so an unfixable finding cannot loop the agent.
- `overlock init codex|cursor|copilot` appends the instruction to the file
  each agent reads.
- Every run appends rule, severity and location — never file contents — to
  `~/.overlock/ledger.jsonl`.

Zero runtime dependencies, no network calls, deterministic.
