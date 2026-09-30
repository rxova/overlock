---
"overlock": patch
---

Take the object checks and the thrown-value message from `@rxova/ts-utils`, inlined at build time, so the package still has no runtime dependencies. An error from another realm now prints its message, and a thrown value that cannot be turned into a string no longer escapes the error handler.
