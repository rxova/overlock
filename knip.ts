import type { KnipConfig } from 'knip';

/**
 * Unused files, exports and dependencies, as a gate rather than a report.
 *
 * The value here is the `export` keyword specifically: an export that nothing
 * imports still has to be kept working, still shows up in editor completions,
 * and still reads as part of the contract. Knip is the only check in this
 * repository that notices one. Entry points are inferred from each package's
 * manifest, so this file stays down to the two things inference cannot know.
 */
export default {
  // `overlock` is this repository's own binary, run against itself in CI (the
  // `overlock on itself` job). Knip sees the invocation but finds no
  // node_modules entry for it, because it is the workspace package.
  ignoreBinaries: ['overlock'],
  // Hints are advice about this config, tags are `@public`-style annotations.
  // Both are failures here: a gate that prints advice nobody has to act on is
  // a gate that stops being read.
  treatConfigHintsAsErrors: true,
  workspaces: {
    'packages/tooling': {
      // Repo scripts, invoked by name from package.json and CI, never imported.
      entry: ['*.ts'],
    },
  },
} satisfies KnipConfig;
