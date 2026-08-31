---
'overlock': patch
---

Close seven holes found by attacking the tool the way its actual adversary would
— an agent with write access to the files overlock reads, optimising for green.

**A patch could silence its own findings and pass in silence.** Adding
`// overlock-ignore RULE -- reason` alongside the very skip it covers produced a
clean report and an exit 0 from the Stop hook, which prints nothing — so from a
phone it was indistinguishable from a genuinely clean run. The gate could be
defeated with one comment line. Directives added by the patch under review now
stop the hook once and quote the claim back to the reader; directives already in
the tree still pass silently, because those record a decision somebody made.

**A directive quoted inside a string silenced real findings.** The same class of
bug already fixed for skip markers, never applied to suppressions. Both now share
one string-blanking helper.

**A skip marker split across two lines evaded the rule entirely.** `it` then
`.skip(...)` on the next line — ordinary formatter output — produced no HIGH
finding at all, so the hook did not block.

**Untracked symlinks were followed out of the repository**, letting a link read a
file outside the tree and print its contents as evidence. Symlinks and non-regular
files are now skipped.

**Control characters passed through into evidence and messages**, which reach a
terminal, an agent's context and pull request comments — an erase-line sequence
in a test name could rewrite the verdict printed above it. Evidence and messages
are now stripped and capped at 1000 characters, so a minified line cannot carry
400KB into an agent's context either.

**A repository with no commits reported itself as not a repository.** An agent
scaffolding a new project is exactly that case; it is now diffed against the
empty tree and reported as "no commits yet".
