---
'overlock': minor
---

Let the Stop hook see what the agent committed

The hook read uncommitted work. Agents commit and then stop, so in the ordinary
workflow it saw nothing at all — a strange blind spot for a tool whose subject
is what your coding agent did to your tests.

At Stop time the patch is now the session: the last commit made before the
session began, through to the working tree. That covers both halves at once,
everything committed during the session and everything still uncommitted.

The session is dated from the birth time of the transcript the Stop payload
names, since that file is created when the session is. Without one — no
transcript, no birth time recorded by the filesystem, no commit before it, no
repository — the hook falls back to `auto`, which is what it did before.

`Overlock-Allow:` trailers consequently work at Stop time now, for commits the
agent made during the session. Work still sitting in the tree still has no
commit message to read, so the inline directive remains the only way to
acknowledge that.
