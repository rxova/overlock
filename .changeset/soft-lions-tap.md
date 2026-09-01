---
'overlock': patch
---

Fix the Node 20 compatibility job, which had never run its check.

It packed with `npm pack --workspace packages/overlock`, and `--workspace` reads
npm's own `workspaces` field from the root manifest. This is a pnpm workspace, so
npm found none and the job failed at the pack step every time — before reaching
anything it was meant to verify. The `engines.node` claim of `>=20.11` stayed
unverified while a job that looked like it was checking sat next to it.

Packing from inside the package needs no workspace support at all. The job's
steps were run end to end locally before this landed: pack, install the tarball
into a scratch consumer, run the published bin, import the library entry, and
check a real repository — exit 1 on a skipped test, as it should be.
