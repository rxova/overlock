import { baseVitestConfig } from "@rxova/repo-config/vitest";

// The repository scripts. The CLI entries and the real process runner are the
// thin edge around them, exercised by the release job itself.
export default baseVitestConfig({
  root: import.meta.dirname,
  include: ["scripts/**/*.test.ts"],
  coverageInclude: ["scripts/**/*.ts"],
  exclude: [
    "scripts/**/*.test.ts",
    "scripts/**/*.fixtures.ts",
    "scripts/**/*.types.ts",
    "scripts/**/*-cli.ts",
    "scripts/release/run-command.ts",
  ],
  reporter: ["text", "json-summary"],
});
