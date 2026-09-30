// Release job entry: `node scripts/release/tag-action-cli.ts`, with PUBLISHED
// set to the release's `published-packages` output.
import { ghReleases } from "./gh-releases.ts";
import { gitRepo } from "./git-repo.ts";
import { publishedVersion } from "./published-version.ts";
import { reportFailure } from "./report-failure.ts";
import { runCommand } from "./run-command.ts";
import { tagAction } from "./tag-action.ts";

try {
  const published = process.env.PUBLISHED ?? "";
  const version = publishedVersion(published);
  if (version === null) {
    throw new Error(`could not read overlock's version from publishedPackages: ${published}`);
  }
  tagAction({
    version,
    repo: gitRepo(runCommand),
    releases: ghReleases(runCommand),
    log: console.log,
  });
} catch (failure) {
  reportFailure(failure);
  process.exitCode = 1;
}
