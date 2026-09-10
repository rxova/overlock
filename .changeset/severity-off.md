---
'overlock': minor
---

Allow a rule to be graded `off`, in `severity` and on `--severity`.

`severity` took `high`, `medium` and `low`, which left a repository that had
read a rule enough to judge it says nothing here with two options: an inline
directive per finding, or an allow trailer in every pull request. That is a lot
of writing to repeat a decision already made — `TEST_AND_IMPL_TOGETHER` fires on
ordinary test-driven work by design, and a repository can reasonably want it
retired rather than acknowledged twenty-four times.

```json
{ "severity": { "TEST_AND_IMPL_TOGETHER": "off" } }
```

`off` is a grade a rule can have, not a severity a finding can carry: no finding
is ever reported as `off`, and `counts` keeps its three keys. What an `off` rule
drops is counted in the new `silenced` field and printed beside the suppression
count in the verdict line, on clean runs too — an escape hatch nobody can count
is one that quietly empties the gate.

Backwards compatible: existing configs and flags are unaffected.
