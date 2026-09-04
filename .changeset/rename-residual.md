---
'overlock': minor
---

Answer the question a rename actually raises: what changed that it does not
explain?

A substitution the patch applies wholesale is now inferred from the patch
itself, and every finding is marked against it. A rename across six hundred
files reports as three lines — the rename, how many findings are consistent with
it, and how many are not — with the residual printed in full above the fold.
The same comparison sees through a formatter, so a line the shorter name let
prettier re-join is not read as a change, and `TEST_AND_IMPL_TOGETHER` no longer
fires on pure re-wrapping.

Nothing is decided by the inference. An explained finding keeps its severity,
still counts, and still blocks — a patch large enough to establish a rename is
large enough to hide one real edit inside, and that residual is the whole point.

`Overlock-Allow: RULE_ID [path] -- reason`, read from the commit messages in the
range and from `--allow-file` (the action passes the pull request body), is the
proportionate way to acknowledge a whole patch. It needs a written reason like
every other escape hatch here, and it does nothing at Stop time, where
uncommitted work has no commit message to read.

Repeated findings are collapsed wherever they are printed: the same edit in
twenty files is one row with a count.

`overlock report` now counts each rule once per run rather than once per
finding, so one afternoon's rename cannot dominate a month of history.
