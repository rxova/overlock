---
'overlock': minor
---

Add `--stage-record`, so the commit being built carries the record of the run that judged it.

An evaluation record is written after the analysis that produced it, so on its own it can only ever
reach the _next_ commit: the evidence for a change trails one commit behind the change, and a
repository collecting records never has a clean working tree. From a pre-commit hook, where the
commit is still being assembled, `overlock check --staged --stage-record` stages the record and
captured patch that run just wrote, and nothing else.

It is a flag rather than a config key because the only run with a commit to join is the one a
pre-commit hook makes. Staging is the one write overlock makes; every other invocation still leaves
the index exactly as it found it, and a repository that has ignored `.overlock` keeps that decision
— the evidence stays on disk and the refusal is reported on stderr.
