---
'overlock': minor
---

Close the untracked-file hole and add inline suppressions.

- **Untracked files are now analysed.** `git diff HEAD` reports nothing about a
  file git has never seen, so a brand-new test file arriving already skipped
  passed completely clean — and creating a test file is the most ordinary thing
  an agent does. Untracked files are rendered as additions, read-only; the index
  is never written to. `--no-untracked` opts out, and `--staged` never includes
  them.
- **`overlock-ignore RULE_ID -- reason`** silences one rule on one line, on that
  line or the line above it. The rule ID and the reason are both required, and
  there is no wildcard. The number of suppressed findings appears in every
  report — clean runs included — and in the ledger.
- CI now verifies the `engines.node` claim by packing on Node 24 and running the
  published tarball under Node 20.
