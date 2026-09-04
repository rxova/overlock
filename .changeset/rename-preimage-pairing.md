---
'overlock': patch
---

See a weakened assertion the same commit's rename would have hidden.

`ASSERTION_WEAKENED` and `EXPECTED_VALUE_CHANGED` pair a removed line with an
added one by comparing their text, so a rename that lands in the subject broke
the pair and the rule fired nothing at all:
`expect(trainmotherfoca.total()).toBe(42)` becoming
`expect(trainmf.total()).toBeDefined()` reported as silence. Both rules now pair
against the pre-image with the patch's inferred substitution applied — the
residual analysis can only mark findings that exist, and there was no finding to
mark. Evidence still shows the lines as the patch wrote them.
