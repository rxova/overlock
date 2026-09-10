// Every docs page, also served as raw markdown at `<route>.md`.
//
// The reader these docs are written for is often not a person. An agent asked to
// change a test suite fetches a rule page to find out what `PREDICATE_NARROWED`
// means, and on the HTML page it pays for the nav, the sidebar and the search
// index to read four paragraphs. This route serves the same content as the
// markdown it was written as: a fraction of the bytes, and nothing to parse.
//
// The build is `static`, so this is a build-time endpoint — every path is
// enumerated by getStaticPaths and written out as a file.
//
// `<route>.md` sits beside `<route>/index.html` rather than inside it, so nothing
// collides: `rules/test-removed/` is a directory and `rules/test-removed.md` is a
// sibling file.

import type { APIRoute, GetStaticPaths } from 'astro';

import { docsPages } from '../lib/docs-md.mjs';
import { renderMarkdown } from '../lib/docs-pages.mjs';

export const prerender = true;

export const getStaticPaths: GetStaticPaths = async () => {
  const pages = await docsPages({
    origin: import.meta.env.SITE,
    base: import.meta.env.BASE_URL,
  });

  // The route param carries no extension: the filename does. `[...slug].md.ts`
  // means slug `rules/test-removed` is written to `rules/test-removed.md`.
  return pages.map((page) => ({ params: { slug: page.id }, props: { page } }));
};

export const GET: APIRoute = ({ props }) =>
  new Response(renderMarkdown(props.page), {
    headers: { 'Content-Type': 'text/markdown; charset=utf-8' },
  });
