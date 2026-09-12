---
'overlock': minor
---

Add an `exclude` setting: repository-root-relative paths left out of the patch the way `.overlock` already is, so another tool's evidence directory (`.basting`, `.saidso`) no longer changes the patch fingerprint on every turn, grows captured diffs recursively, or makes `auto` read the working tree. Excluded paths are absent from findings, file counts, base selection and snapshots, and the evaluation record carries the setting. Entries are literal prefixes; globs, pathspec magic, `..` and filesystem paths are refused.
