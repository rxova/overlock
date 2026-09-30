import type { Registry, Run } from "./release.types.ts";

/** `Registry` over `npm view`. A version npm does not serve yet is a non-zero exit. */
export function npmRegistry(run: Run): Registry {
  return {
    serves: (name, version) => {
      try {
        return run("npm", ["view", `${name}@${version}`, "version"]).trim() === version;
      } catch {
        return false;
      }
    },
  };
}
