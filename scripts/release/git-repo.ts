import type { Repo, Run } from "./release.types.ts";

/** `Repo` over the git CLI in the current checkout. */
export function gitRepo(run: Run): Repo {
  return {
    fetchTags: () => void run("git", ["fetch", "--tags", "--force", "origin"]),
    commitOf: (ref) => {
      try {
        return run("git", ["rev-list", "-n", "1", ref]).trim() || null;
      } catch {
        return null;
      }
    },
    tag: (name, sha, { force = false } = {}) => {
      const flag = force ? ["-f"] : [];
      run("git", ["tag", ...flag, name, sha]);
      run("git", ["push", ...flag, "origin", name]);
    },
    show: (sha, path) => run("git", ["show", `${sha}:${path}`]),
  };
}
