<!--
The title becomes the squash subject, so it has to be a valid Conventional
Commit on its own. Commitlint checks it.
-->

## What this changes

<!-- One or two sentences. What behaviour is different after this merges? -->

## Why

<!-- The problem this solves. Link the issue if there is one. -->

## How it was verified

<!-- Which of these you ran, and anything you checked by hand. -->

- [ ] `pnpm run verify`
- [ ] `pnpm run e2e`
- [ ] New or updated tests cover the change, including the cases it must _not_ fire on

## Checklist

- [ ] No new runtime dependency in `packages/overlock`
- [ ] Changeset added (`pnpm changeset`), or the change does not touch the published package
- [ ] Rule IDs unchanged, or the change is flagged as breaking
- [ ] README and `llms.txt` updated if a rule, flag or config key changed
