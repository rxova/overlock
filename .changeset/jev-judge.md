---
'overlock': minor
---

Add an opt-in model judge and the `JUDGED_WEAKENING` finding. With `--judge` (or `"judge": true` in the config) and `TYPESAFE_API_KEY` set, overlock sends changed test cases that no rule flagged to TypeSafe's Jev decision model. It reports the ones Jev judges now verify less than before, such as a mock rewritten to return what the assertion expects. A finding needs two answers to agree, is graded `medium`, only ever adds to the deterministic report and never fails a run. The report's new `judge` field says what was asked, what was answered and why nothing was, when nothing was. It is off by default, and the endpoint cannot be set from a config file.
