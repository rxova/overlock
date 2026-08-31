---
'overlock': minor
---

Ship a composite GitHub Action, so adopting overlock in CI is three lines.

```yaml
- uses: rxova/overlock@v0
```

On a pull request it diffs against the base commit rather than `github.sha` —
which on a PR is the merge commit, and would report nothing — and posts a single
findings comment that is edited in place on later pushes rather than appended
to.

That comment is the point: the person who most wants this check is the reviewer,
and until now the only place it spoke was a terminal the reviewer never sees.

The action writes no ledger. That file records what your agents did on your
machine; a CI runner is neither, and it is thrown away.

This repository now gates its own pull requests through the action rather than
the binary, with `cli-path` pointing at the branch's build — so the action is
exercised on every change, and the gate is the code under review rather than the
last release.
