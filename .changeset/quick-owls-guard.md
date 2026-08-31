---
'overlock': patch
---

Close four holes found by attacking overlock as a weapon rather than as a gate —
an attacker who wants to use the tool against whoever runs it.

**A `--base` that was really a git option gave arbitrary file write.**
`git diff --output=FILE` writes wherever it is pointed, and `base` is reachable
from the CLI _and_ from the MCP `base` tool argument — so any MCP client, or an
agent that read a hostile instruction in a file, could overwrite a shell profile
or an `authorized_keys` as the user. The same trick with `--ext-diff` would have
undone the `--no-ext-diff` that keeps external diff drivers from running. Refs
that begin with a dash are now refused at both boundaries, and a `--` terminator
is appended so nothing downstream can be read as an option.

**An unrecognised `--fail-on` disabled the gate.** It made every severity
comparison false, so a patch carrying a HIGH finding reported `ok: true`. It was
unreachable from the CLI, which validates, but wide open over MCP. Unknown values
now fail closed at `high`, and MCP rejects them outright so the caller learns.

**A file name could break out of the pull request comment.** A backtick closes
the markdown code span and a newline ends the row and starts one the attacker
writes — on any pull request, in a comment posted by the repository's own token.
Paths are stripped of backticks and control characters, and the action's table
renderer strips them again on its side.

**The action interpolated `${{ }}` into shell scripts.** The values were ones it
computed itself, but expressions are pasted in before bash sees them, so they now
go through `env` — that pattern is how the next change becomes an injection.

Also: evidence, messages and paths are labelled as quoted repository content
where they reach an agent, since a test name is attacker-controlled text arriving
in a context window.

Checked and found sound: no ReDoS (pathological 60–80KB lines against the string
and suppression patterns all complete in under 100ms), and MCP `id: 0` is
answered rather than mistaken for a notification.
