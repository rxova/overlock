// Release job entry: `node scripts/release/check-tags-cli.ts`, from a checkout
// of the default branch, whose manifest names the version to check.
import { readFileSync } from "node:fs";
import { checkTags } from "./check-tags.ts";
import { gitRepo } from "./git-repo.ts";
import { npmRegistry } from "./npm-registry.ts";
import { reportFailure } from "./report-failure.ts";
import { runCommand } from "./run-command.ts";

try {
  const manifest = JSON.parse(readFileSync("packages/overlock/package.json", "utf8")) as {
    version: string;
  };
  checkTags({
    version: manifest.version,
    repo: gitRepo(runCommand),
    registry: npmRegistry(runCommand),
    log: console.log,
  });
} catch (failure) {
  reportFailure(failure);
  process.exitCode = 1;
}
