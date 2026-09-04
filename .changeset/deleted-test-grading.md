---
'overlock': minor
---

Grade a deleted test file on what the patch does with its cases, and give it a
way out.

`TEST_REMOVED` now matches the case names a deleted file lost against every name
the patch adds anywhere in it, rather than per file — so splitting one test file
into six is visible to it. All names re-homed grades `medium`; some missing
stays `high` and names the ones that went. Deleting the module a test file is
named after also grades `medium`, since deleting a feature deletes its tests.

Findings about a file rather than a line now report `line: null` and an `id` of
`<rule>:<file>`, instead of pointing at a line 1 that a deleted file does not
have. They are silenced by naming the path from a line the patch still has:
`// overlock-ignore TEST_REMOVED src/api.test.ts -- reason`. Previously they
could not be silenced at all.

`--severity RULE_ID=level` (and the action's `severity` input) regrades one rule
without dropping `--fail-on` globally and disarming the others.

The action's pull request comment now leads with what blocks and folds the rest,
grouped by rule, into a `<details>`.
