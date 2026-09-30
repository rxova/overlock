import { baseKnipConfig } from "@rxova/repo-config/knip";

/**
 * Unused files, exports and dependencies, as a gate rather than a report.
 *
 * The value here is the `export` keyword specifically: an export that nothing
 * imports still has to be kept working, still shows up in editor completions,
 * and still reads as part of the contract. Knip is the only check in this
 * repository that notices one. Entry points are inferred from each package's
 * manifest; the preset's `apps/docs` default covers `@rxova/brand`, which the
 * docs reach through the Starlight preset's CSS.
 */
export default baseKnipConfig({
  // `rxova-repo-config check-exports` runs `attw` from a shell command, where knip cannot see it.
  ignoreDependencies: ["@arethetypeswrong/cli"],
});
