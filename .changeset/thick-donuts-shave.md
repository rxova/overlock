---
'overlock': patch
---

Neutral wording in the help text, the package description and the code
comments, and a neutral placeholder name in the rename examples.

No behaviour changes: the rules, their severities, the JSON schema and every
flag are unchanged. `overlock --help` now opens with "report test-integrity
findings in a git patch", `--compact` is described as the short form for small
screens and hook output, and `init codex|cursor|copilot` says that an
instruction is advisory where the Claude Code Stop hook can block a turn.

The inferred-rename documentation and fixtures use `warehouserouting ->
routing` in place of the previous placeholder.
