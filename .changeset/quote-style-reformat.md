---
'overlock': patch
---

Stop reporting a quote-style reformat as changed or weakened assertions. `'high'` and `"high"` now compare as the same value, so a formatter switching quote style no longer produces `EXPECTED_VALUE_CHANGED`, and an assertion whose only change is its quotes is no longer read as removed and paired with its neighbour as `ASSERTION_WEAKENED` or `ASSERTION_NARROWED`. A value that changed along with its quotes is still reported, as written.
