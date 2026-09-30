import type { Log, Registry, Repo } from "./release.types.ts";

/**
 * The registry has the last word: if npm serves `version`, both tags naming it
 * must exist. A release once published to npm and tagged nothing, green,
 * because a third-party output silently went false.
 */
export function checkTags({
  version,
  repo,
  registry,
  log,
}: {
  version: string;
  repo: Repo;
  registry: Registry;
  log: Log;
}): void {
  if (!registry.serves("overlock", version)) {
    log(`overlock@${version} is not on npm; nothing to tag.`);
    return;
  }
  repo.fetchTags();
  const missing = [`overlock@${version}`, `v${version}`].filter(
    (tag) => repo.commitOf(tag) === null,
  );
  if (missing.length > 0) {
    throw new Error(
      [
        `overlock@${version} is published, but these tags are missing: ${missing.join(" ")}`,
        "The release is half done: npm has it and this repository cannot point at it.",
      ].join("\n"),
    );
  }
  log(`overlock@${version} is published and tagged.`);
}
