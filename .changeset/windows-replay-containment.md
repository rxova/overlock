---
"overlock": patch
---

`overlock replay` now refuses a manifest entry that climbs out of the corpus on Windows too. The check looked for `../`, and on Windows `path.relative` answers `..\`, so an entry such as `../outside.diff` was read from outside the corpus instead of being refused.
