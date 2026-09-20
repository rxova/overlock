---
'overlock': patch
---

Drop `export` from nine symbols that nothing imported. The published API is unchanged — none of them was re-exported from `src/index.ts` — but the built output no longer carries them.
