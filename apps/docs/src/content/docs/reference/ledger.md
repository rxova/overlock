---
title: The legacy ledger
description: Local run history, its limits, and portable evaluation records.
sidebar:
  order: 6
---

Every run appends one line to `~/.overlock/ledger.jsonl`: timestamp, repository, branch, which rules
fired, and whether the run failed. It records rule, severity and location only, never source.
Nothing is uploaded.

`overlock report` summarizes that history. `--days <n>` chooses the window and `--json` emits data.
The human output says **Flagged**, not "Caught": the JSON field `caught` remains for compatibility,
but counts runs with a high or medium finding. The same patch checked fifty times can produce fifty
flagged runs. This is not fifty distinct defects or fifty useful corrections.

Current records compute `blocked` from the final hook decision. Older records estimated it from
the presence of findings, so historical block counts cannot be assumed accurate. Suppression
counts are acknowledgments, not independent evidence that a change was harmless. Low findings are
listed separately under Noted and Context only.

The legacy ledger does not have patch fingerprints, build identities, review labels, or findings
silenced by configuration. It cannot establish whether the tool is useful. The deprecated
`meetsBar` API therefore returns false. Use [repository evaluation](evaluation.md) for portable
records, independently reviewed outcomes, and replay against a labeled corpus.

## Storage and CI

`--no-ledger` skips this legacy record. `OVERLOCK_LEDGER` sets the full file path; otherwise
`OVERLOCK_HOME` replaces `~/.overlock`. Neither controls opt-in repository evaluation, whose
records live at the git root under `.overlock/`.

The GitHub Action disables the home ledger. Repository evaluation can still record its analysis
invocation and export it as a CI artifact. Its human-log rendering invocation does not record a
second evaluation event.

The format is JSON Lines. `readLedger` and `summarize` remain exported for historical analysis.
