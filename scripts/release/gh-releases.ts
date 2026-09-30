import type { Releases, Run } from "./release.types.ts";

/** `Releases` over the gh CLI. `--latest`, because the Marketplace follows the latest release. */
export function ghReleases(run: Run): Releases {
  return {
    exists: (tag) => {
      try {
        run("gh", ["release", "view", tag]);
        return true;
      } catch {
        return false;
      }
    },
    create: ({ tag, sha, notes }) =>
      void run(
        "gh",
        [
          "release",
          "create",
          tag,
          "--target",
          sha,
          "--title",
          tag,
          "--notes-file",
          "-",
          "--latest",
        ],
        notes,
      ),
  };
}
