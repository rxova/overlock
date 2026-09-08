---
'overlock': minor
---

Read assertions and test cases at the scale of the test, not the line.

Four false positives reported from real use, and the four fixes are the same
idea: a finding is only worth as much as the reason attached to it.

- **`ASSERTION_NARROWED`, a new rule.** `expect(row).toEqual({ id, state })`
  becoming `expect(row.state).toBeNull()` is a real finding with a wrong reason
  when it is called a weakened assertion — the assertion still names a value, it
  just covers less of it. Narrowing now has its own rule ID and its own sentence.
- **The existence-check family is three members wide.** `toBeDefined()`,
  `toBeTruthy()` and `not.toBeNull()`. `toBeNull()`, `toBeUndefined()` and
  `toBe(false)` name a value as exactly as `toBe(3)` does and no longer report as
  weakened; the message says which loose thing the replacement does check.
- **Pairing is per edit, not per hunk.** A hunk spans several test cases, and a
  removal in one was being paired with an addition in another. An assertion that
  is still standing further down the file is a move, not a weakening.
- **Findings are graded by the case around them.** A test that gives up
  specificity on one line while gaining assertions elsewhere is `medium` and says
  how many it gained; one that only lost stays `high`.
- **A retitled test is not a removed one.** `TEST_REMOVED` matches a case by its
  title, by its title under the patch's own rename, and failing both by its body.
- **Moved spec files collapse into one finding.** Eight files re-homed is one
  decision, one finding and one acknowledgement rather than eight of each.
- **Acknowledgements can be as narrow as the finding.** `Overlock-Allow:` takes
  `<path>`, `<path>:<line>` or a quoted `<path>::<case name>`, so fifteen ported
  cases can be acknowledged while the two nobody explained keep standing. One
  that matches nothing is now reported as `allowances_unused` rather than
  silently doing nothing.
- **A name that became two names is one rename.** `cloud_sync` splitting into
  `cloud_backup` and `multi_device` is inferred as a split, and whatever is left
  unexplained is clustered by the name most of it mentions.

The wire contract gains `subject` on a finding and `allowances_unused` on the
report; nothing existing changed meaning.
