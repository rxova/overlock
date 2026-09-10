---
title: The JSON report
description: The schema is the API, and the rule IDs are frozen.
sidebar:
  order: 4
---

```bash
overlock --json
```

```json
{
  "schema": 1,
  "ok": false,
  "base": "HEAD",
  "counts": { "high": 1, "medium": 0, "low": 0 },
  "suppressed": 0,
  "silenced": 0,
  "findings": [
    {
      "id": "TEST_SKIPPED_ADDED:src/auth.test.ts:42",
      "rule": "TEST_SKIPPED_ADDED",
      "severity": "high",
      "file": "src/auth.test.ts",
      "line": 42,
      "message": ".skip added — this test no longer runs.",
      "evidence": { "after": "it.skip('rejects expired tokens', async () => {" },
      "fix_hint": "Make the test pass, or delete it deliberately and say why."
    }
  ]
}
```

This is the interface. If you are building anything on overlock's output — a dashboard, a bot, a different gate — read this, not the human output, which exists to be read by a person and is free to change.

## The report

| Field               | Meaning                                                   |
| ------------------- | --------------------------------------------------------- |
| `schema`            | Currently `1`. Bumped only for a breaking change          |
| `ok`                | Whether the run passed, given `fail_on`                   |
| `base`              | The resolved range, echoed so a log says what was checked |
| `fail_on`           | The threshold in force                                    |
| `scope`             | `{ files, commits }` — the size of what was read          |
| `findings`          | The findings, in report order                             |
| `counts`            | `{ high, medium, low }`                                   |
| `suppressed`        | How many findings a directive silenced                    |
| `silenced`          | How many a rule graded `off` dropped                      |
| `suppressed_new`    | How many of those the patch itself added                  |
| `renames`           | The substitutions inferred from the patch                 |
| `explained`         | Findings the patch accounts for                           |
| `allowed`           | The allowances that matched something                     |
| `allowances_unused` | The allowances that matched nothing                       |
| `suppressions_new`  | The directives this patch introduced                      |

`counts` keeps its three keys whatever the config says. `off` is a grade a rule can have, not a severity a finding can carry: no finding is ever reported as `off`, it is dropped and counted in `silenced`. Both `silenced` and `suppressed` are reported on clean runs too — a gate that empties quietly is not a gate. See [configuration](configuration.md#grading-a-rule-off).

`suppressed_new` and `suppressions_new` are the ones to wire up if you are building your own gate. A patch that silences its own findings is the signal the [Stop hook](../integrations/claude-code.md) stops on, and it is available to anything else that wants it.

## A finding

| Field          | Meaning                                                          |
| -------------- | ---------------------------------------------------------------- |
| `id`           | `<rule>:<file>:<line>`, or `<rule>:<file>` when there is no line |
| `rule`         | One of the thirteen frozen [rule IDs](../rules/overview.md)      |
| `severity`     | `high` \| `medium` \| `low`                                      |
| `file`         | Repository-relative path                                         |
| `line`         | `null` when the finding is about a file rather than a line in it |
| `subject`      | What the finding is about, when there is one                     |
| `message`      | The sentence printed to a human                                  |
| `evidence`     | `{ before?, after? }` — the lines themselves                     |
| `fix_hint`     | What to do instead                                               |
| `explained_by` | Present when the rest of the patch accounts for the change       |

`explained_by` carries a string such as `"warehouserouting -> routing"` or `"reformatting only"`. **It never changes a verdict** — an explained finding keeps its severity, still counts, and still fails the run if it was going to. The inference only changes the order things are presented in. See [renames and reformatting](../under-the-hood/renames-and-reformatting.md).

## The IDs are frozen

Adding a rule is a minor release. Changing what an existing ID means is a breaking one.

They have to be, because the IDs are load-bearing in three places that outlive any run: `overlock-ignore` directives in source, `Overlock-Allow:` trailers in commit history, and `severity` entries in committed config. A rule ID that quietly grew to cover a new pattern would silently widen every suppression naming it — a permission somebody granted for one thing, applied to something they never saw.

`RULE_IDS` is exported from the package, so a consumer can enumerate them without hardcoding the list. See [programmatic use](api.md).

## Evidence is quoted source code

`evidence.before` and `evidence.after` are lines from the patch, written by whoever wrote the patch. They are stripped of control characters and capped in length before they reach your terminal, an agent's context or a pull request comment — see [untrusted input](../under-the-hood/untrusted-input.md) — but they are still someone else's text arriving in your pipeline. Treat them accordingly.

This is also why the [ledger](ledger.md) records rule, severity and location and never evidence: the evidence lines are source code.
