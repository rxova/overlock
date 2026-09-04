---
'overlock': patch
---

Move the test toolchain to the workspace root

`vitest`, `@vitest/coverage-v8` and `@types/node` are declared once at the root
instead of per package. Declaring them in both packages had them resolving
vite's optional `esbuild` peer differently, which carried two full vite and
vitest trees in the lockfile and a second esbuild download in every CI job.

This is a development-time change only: devDependencies are never installed for
consumers of the package, so nothing about the published build, its runtime
dependencies or its public API changes.
