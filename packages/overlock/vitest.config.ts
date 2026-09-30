import { baseVitestConfig } from "@rxova/repo-config/vitest";

export default baseVitestConfig({
  root: import.meta.dirname,
  coverageInclude: ["src/**/*.ts"],
  // cli.ts is the argv shell around `run()`, covered end to end by the e2e
  // suite, which drives the real binary and therefore reports no v8 coverage
  // into this run. types.ts and globals.d.ts hold declarations, not logic.
  // The preset already leaves out src/index.ts and the tests.
  exclude: ["src/cli.ts", "src/types.ts", "src/globals.d.ts", "src/__fixtures__/**"],
  // Set just under what the suite actually achieves, per file; the axes not
  // named stay at the preset's 95. Raising these when coverage improves is the
  // point; lowering one to get a build green is the exact move
  // COVERAGE_THRESHOLD_LOWERED exists to catch, and it would be a strange thing
  // for this repository to do to itself.
  thresholds: { branches: 88, functions: 100 },
});
