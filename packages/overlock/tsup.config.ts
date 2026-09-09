import { readFileSync } from 'node:fs';
import { defineConfig } from 'tsup';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as {
  version: string;
};

export default defineConfig({
  entry: { index: 'src/index.ts', cli: 'src/cli.ts' },
  format: ['esm'],
  target: 'node20',
  dts: true,
  clean: true,
  splitting: false,
  sourcemap: true,
  minify: false,
  // Read from the manifest rather than duplicated here, so `--version` cannot
  // disagree with what npm installed.
  define: { __OVERLOCK_VERSION__: JSON.stringify(pkg.version) },
  // ESM-only, and nothing to externalise: there are no runtime dependencies.
  // That is deliberate — `npx overlock` on a cold cache is one small download,
  // and an agent runs it on every turn.
});
