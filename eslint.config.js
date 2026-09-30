import { rxova } from "@rxova/repo-config/eslint";

export default rxova({
  tsconfigRootDir: import.meta.dirname,
  node: true,
  tests: true,
  // The CLI's output is its interface, and the e2e suite reports what it ran.
  consoleAllowed: ["packages/overlock/src/cli.ts", "packages/overlock/src/cli/**", "scripts/**"],
  rules: {
    "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
    "@typescript-eslint/consistent-type-imports": ["error", { fixStyle: "inline-type-imports" }],
  },
});
