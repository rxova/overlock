import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['*.test.ts'],
    coverage: {
      provider: 'v8',
      // `text` for a human reading CI logs, `lcov` for the coverage service.
      reporter: ['text', 'lcov'],
      all: true,
      // Listed one by one rather than globbed, because a script only belongs
      // here once it has been split into testable pieces — the rest are still
      // top-level side effects that run on import. Move a file into this list
      // in the change that gives it a suite; the thresholds below then hold it
      // to the same bar as everything already here.
      include: ['audit.ts'],
      thresholds: {
        perFile: true,
        statements: 95,
        branches: 95,
        functions: 95,
        lines: 95,
      },
    },
  },
});
