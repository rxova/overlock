---
'overlock': patch
---

Crafted input no longer stalls a run. Four parsers backtracked quadratically on text the patch author controls: an `Overlock-Allow:` trailer with a long run of spaces in its reason, a `diff --git` header made of many quoted segments, a line holding a string literal of escaped quotes that never closes (`"\"\"\"…`), and an `exclude` entry with a long run of slashes. Each now reads in linear time, and every result is the same as before.
