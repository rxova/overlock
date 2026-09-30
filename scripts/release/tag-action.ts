import { changelogNotes } from "./changelog-notes.ts";
import type { Log, Releases, Repo } from "./release.types.ts";

/**
 * Tags and releases the action for a version npm just received.
 *
 * The Marketplace lists an action from a release whose tag is semver, and
 * `overlock@X.Y.Z` is not one, so the action gets its own `vX.Y.Z` on the same
 * commit. That tag is never moved: if it already names another commit, the
 * action was released at this version before npm reached it, and the listing
 * would quietly stop updating. `vMAJOR` is the moving tag consumers pin.
 */
export function tagAction({
  version,
  repo,
  releases,
  log,
}: {
  version: string;
  repo: Repo;
  releases: Releases;
  log: Log;
}): void {
  repo.fetchTags();
  const sha = repo.commitOf(`overlock@${version}`);
  if (sha === null)
    throw new Error(`overlock@${version} is not tagged, so there is no commit to release.`);

  const tag = `v${version}`;
  const tagged = repo.commitOf(tag);
  if (tagged !== null && tagged !== sha) {
    throw new Error(
      [
        `${tag} already names ${tagged}, but this release is ${sha}.`,
        `The action was released at ${version} before npm reached it.`,
        "Bump past it with a changeset, then re-run: a version tag is not moved.",
      ].join("\n"),
    );
  }
  // An equal `tagged` is this same publish re-run.
  if (tagged === null) repo.tag(tag, sha);

  const major = version.split(".")[0] as string;
  log(`pointing v${major} at ${sha}`);
  repo.tag(`v${major}`, sha, { force: true });

  if (releases.exists(tag)) {
    log(`${tag} is already released`);
    return;
  }
  const notes = changelogNotes(repo.show(sha, "packages/overlock/CHANGELOG.md"), version);
  releases.create({ tag, sha, notes });
}
