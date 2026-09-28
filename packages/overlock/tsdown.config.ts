import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { defineConfig } from 'tsdown';
import { baseBuildConfig } from '@rxova/repo-config/tsdown';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as {
  version: string;
};

// ESM-only, as the preset builds, and nothing to externalise: there are no
// runtime dependencies. That is deliberate — `npx overlock` on a cold cache is
// one small download, and an agent runs it on every turn. The preset's `.js`
// extensions already match the published `bin` and `exports` paths; only the
// Node floor is lowered, to the `engines.node` this package promises.
export default defineConfig(
  baseBuildConfig({
    entry: { index: 'src/index.ts', cli: 'src/cli.ts' },
    target: 'node20',
    sourcemap: true,
    // Deterministic chunk names. A content hash in the shared chunk would churn
    // the tarball on every unrelated edit, and `pack:smoke` diffs the contents.
    hash: false,
    // @rxova/ts-utils is a dev dependency on purpose: the few helpers used are
    // inlined here, so the tarball keeps its zero runtime dependencies. Anything
    // else that ends up in the bundle is a mistake the build should name.
    deps: { onlyBundle: ['@rxova/ts-utils'] },
    // Read from the manifest rather than duplicated here, so `--version` cannot
    // disagree with what npm installed.
    define: {
      __OVERLOCK_VERSION__: JSON.stringify(pkg.version),
      __OVERLOCK_BUILD__: JSON.stringify(
        createHash('sha256')
          .update(
            readdirSync('src', { recursive: true })
              .map(String)
              .filter((p) => p.endsWith('.ts') && !p.endsWith('.test.ts'))
              .sort()
              .map((p) => p + '\n' + readFileSync('src/' + p, 'utf8'))
              .join('\n'),
          )
          .digest('hex'),
      ),
    },
  }),
);
