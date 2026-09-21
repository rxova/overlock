# Changesets

A pull request that changes `overlock` adds one of these: run `pnpm changeset`, pick the bump, and
commit the file it writes. The summary becomes the changelog entry. CI checks for one; a pull
request that changes the package but publishes nothing (a dev dependency bump, say) is labelled
`skip-changeset` instead.

Once CI passes on `main`, the Release workflow gathers them into a `chore: version packages` pull
request. Merging that one publishes to npm and moves the `v0` tag the action is consumed by.
