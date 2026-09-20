---
'overlock': patch
---

Build with tsdown instead of tsup. The published output is unchanged in shape — ESM-only, same `dist/index.js`, `dist/cli.js` and type declarations — but rolldown shares code between the two entries rather than duplicating it, so the tarball is smaller.
