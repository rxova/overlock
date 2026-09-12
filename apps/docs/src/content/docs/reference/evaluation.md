---
title: Evaluation
description: Portable run records, reviewed outcomes, and corpus replay.
---

Opt in with a stable repository identity:

```json
{
  "evaluation": { "repository": "team/project", "captureDiff": true }
}
```

Runs go to `.overlock/runs/<session>.jsonl` at the git root. `OVERLOCK_SESSION_ID` groups manual
or container runs; Stop hook session IDs are used when available. Without an ID, each invocation
gets a separate shard. `OVERLOCK_ENVIRONMENT` labels the environment, and `OVERLOCK_SOURCE=probe`
keeps deliberately generated events separate from organic work. The built CLI records both its
package version and a source build hash, so unpublished builds remain distinguishable.

Records include base and HEAD object IDs, the exact analyzed-diff hash, effective settings,
duration, scope, errors, final exit code, actual hook decision, and findings before and after
suppression. Unlike the legacy home ledger, this opt-in record includes source evidence.
`captureDiff` additionally saves exact diffs once under `.overlock/patches/<hash>.diff`, including
uncommitted work that might otherwise disappear with a container. Recording failures are visible
on stderr and do not alter the integrity verdict. Invalid configuration fails before collection
can be initialized; configuration errors remain on stderr.

The root `.overlock` directory is reserved for evidence and excluded from analysis, automatic
base selection, and scope counts. Keep application code and tests outside it. Commit completed
records periodically, or export them from containers before disposal. A container needs a mounted
checkout or an explicit artifact export; the tool never commits or transmits records itself.
Other tools' evidence directories can be left out the same way with the
[`exclude` setting](configuration.md#leaving-paths-out), e.g. `"exclude": [".basting", ".saidso"]`;
each record carries it in `settings.exclude`.

```sh
overlock evaluate              # Markdown: distinct findings and reviewed outcomes
overlock evaluate --json       # Includes finding keys and evidence for review
overlock evaluate --build HASH # Filter to one recorded build
overlock import ./artifact     # Import runs/ and optional patches/; idempotent
overlock replay ./manifest.json
```

`--no-ledger` controls the legacy home ledger. `--no-evaluation` or
`OVERLOCK_NO_EVALUATION=1` disables repository recording. The action honors configured collection
on its analysis invocation and disables it on the log-rendering invocation; upload `.overlock/runs`
and `.overlock/patches` as artifacts with hidden files enabled and `if: always()`.

Independent review files live in `.overlock/reviews/*.json`:

```json
{
  "schema": 1,
  "finding": "key-from-evaluate-json",
  "label": "useful_correction",
  "reason": "The warning led to restoring an assertion we needed.",
  "reviewer": "maintainer",
  "warranted_block": true,
  "minutes": 2,
  "resolution": "resolving-commit"
}
```

Labels are `useful_correction`, `legitimate_change`, `false_alarm`, and `missed`. A useful correction
requires a resolution reference. A miss can use a new stable key and must be explained against an
independent patch. `duplicate_of` links a revised patch to a canonical review; its outcome counts
once, but repeated review time still counts. Duplicate or orphaned reviews fail visibly. Reviews
are judgments supplied by the maintainer, never inferred from suppression or a later green run.

Replay manifests use `{ "schema": 1, "cases": [...] }`. Each case has an `id`, relative `diff` path,
`kind` (`historical` or `probe`), `split` (`development` or `holdout`), `expected` (non-low rule IDs
or null when unreviewed), and optional `expected_block` (boolean or null). Detection and warranted
blocking are scored separately. Replay performs no git writes, ledger writes, or network calls;
exit 1 means an oracle mismatch, exit 2 invalid input. Historical null labels are never scored as
successful detections. Run the same corpus against candidate and baseline builds; retain a holdout
subset and report real sample sizes.

The old `report` command remains a run-history view. Its JSON `caught` field is retained for
compatibility and means runs with high/medium detections, not verified saves. The deprecated
`meetsBar` API now always returns false: legacy telemetry cannot establish usefulness.
