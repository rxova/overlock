import { fileURLToPath } from 'node:url';

import { defineConfig } from 'astro/config';
import { unified } from '@astrojs/markdown-remark';
import starlight from '@astrojs/starlight';
import starlightLinksValidator from 'starlight-links-validator';
import sitemap from '@astrojs/sitemap';
import { sharedStarlightConfig } from '@rxova/brand';

import { rehypeMdLinks } from './src/lib/rehype-md-links.mjs';

/**
 * The defaults keep a standalone build working — `pnpm --filter @overlock/docs dev`
 * serves the site at the root. CI overrides both so the dist is built for the
 * path rxova.org actually mounts it at, `/packages/overlock/`. An absolute
 * reference that only resolves at a domain root is invisible in a root build and
 * breaks the moment it is mounted, which is why the published build never uses
 * these values.
 */
const site = process.env.DOCS_URL ?? 'https://rxova.org';
const base = process.env.DOCS_BASE_URL ?? '/';

export default defineConfig({
  site,
  base,

  markdown: {
    // The content links between pages as `../rules/test-removed.md`, which is
    // what the `.md` twins need and what Astro emits verbatim into the HTML. One
    // of those two has to be rewritten, and rewriting the HTML is the side that
    // keeps the source readable as files.
    processor: unified({
      rehypePlugins: [
        [
          rehypeMdLinks,
          { base, docsRoot: fileURLToPath(new URL('src/content/docs', import.meta.url)) },
        ],
      ],
    }),
  },

  integrations: [
    // Nothing else here enumerates these pages for a crawler. The docs answer
    // questions people type into a search engine — "agent skipped my test",
    // "block a commit that lowers the coverage threshold" — and none of that is
    // reachable if the only route in is a link from a site with no inbound ones.
    //
    // Emitted at the mount rather than the domain root: under the aggregator the
    // file lands at <base>sitemap-index.xml and lists only URLs beneath that
    // prefix, which is the scope a sitemap at a subpath is allowed to claim.
    // rxova.org's root robots.txt is what points at it — this build never owns a
    // robots.txt, because crawlers only read one from the origin root.
    sitemap({
      // The canonical HTML pages only. Every one of them also has a `.md` twin,
      // and llms.txt is built from the same enumeration, so listing those here
      // would hand a search engine three URLs per page and ask it to pick.
      // Agents construct the twin URL from the page URL; they do not need it
      // advertised.
      filter: (page) => !page.endsWith('.md') && !/\/llms(?:-full)?\.txt$/.test(page),
    }),
    starlight({
      ...sharedStarlightConfig({
        project: 'overlock',
        // These docs ship as a page component: rxova.org composes each rendered
        // body into its own header and footer, so this build must not draw the
        // umbrella footer itself.
        pageComponent: true,
        sidebar: [
          { label: 'Learn', items: [{ autogenerate: { directory: 'learn' } }] },
          { label: 'Rules', items: [{ autogenerate: { directory: 'rules' } }] },
          { label: 'Integrations', items: [{ autogenerate: { directory: 'integrations' } }] },
          { label: 'Reference', items: [{ autogenerate: { directory: 'reference' } }] },
          {
            label: 'Under the hood',
            items: [{ autogenerate: { directory: 'under-the-hood' } }],
          },
        ],
      }),
      plugins: [
        // Every page here links to several others, and the pages are named after
        // rule IDs that are frozen — so a link that rots is a link to a rule
        // page somebody renamed against the contract. Worth failing the build for.
        starlightLinksValidator({ errorOnRelativeLinks: false }),
      ],
    }),
  ],
});
