import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['e2e/**/*.e2e.ts'],
    // Each case builds a real git repository in a temp directory and spawns the
    // packed binary against it. That is slower than a unit test and it is the
    // point: the unit suite proves the rules fire on a parsed diff, this proves
    // the tool produces that diff from real git, exits with the right code, and
    // speaks the hook protocol Claude Code actually reads.
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // Spawning git and node per case; parallel files race on nothing but they
    // do multiply memory, and the suite is small enough that serial is honest.
    fileParallelism: false,
  },
});
