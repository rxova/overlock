---
'overlock': patch
---

Stop the Claude Code hook raising the same self-suppression twice. A directive
the patch wrote about itself stops the hook once and quotes the claim back — but
"once" was decided from `stop_hook_active` alone, which the agent sets only on
the Stop that directly follows a blocked one. Every later turn arrived with the
flag false, found the same directive still new against the same base, and
stopped again, for the life of the branch.

The hook now records what it quoted — rule, file, the path it names and a hash
of the reason — in `~/.overlock/announced.jsonl`, scoped to the repository and
branch, and skips the stop when every claim in the patch has already been put to
a person. Changing a reason or adding another directive is a new claim and still
stops once. `OVERLOCK_ANNOUNCED` sets the file's path; `OVERLOCK_HOME` moves it
with the ledger. Findings nobody silenced are untouched: those still stop every
turn until they are fixed.

Run records tell the two apart: a turn let through this way is `already_announced`
rather than `retry_bypass`.
