import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      // `text` for a human reading CI logs, `lcov` for the coverage service.
      reporter: ['text', 'lcov'],
      all: true,
      include: ['src/**/*.ts'],
      // index.ts is a re-export barrel and cli.ts is the argv shell around
      // `run()`; both are covered end to end by the e2e suite, which drives the
      // real binary and therefore reports no v8 coverage into this run.
      exclude: [
        'src/index.ts',
        'src/cli.ts',
        'src/types.ts',
        'src/globals.d.ts',
        'src/__fixtures__/**',
        'src/**/*.test.ts',
      ],
      // Set just under what the suite actually achieves, per file. Raising
      // these when coverage improves is the point; lowering one to get a build
      // green is the exact move COVERAGE_THRESHOLD_LOWERED exists to catch, and
      // it would be a strange thing for this repository to do to itself.
      thresholds: {
        perFile: true,
        statements: 95,
        branches: 88,
        functions: 100,
        lines: 95,
      },
    },
  },
});
