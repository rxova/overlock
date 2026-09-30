import type { APIRoute, GetStaticPaths } from "astro";
import { renderMarkdown, type DocsPage } from "@rxova/docs-kit";
import { pages } from "../lib/docs";

// A raw-Markdown twin of every page at `<route>.md`, for agents: the content as
// it was written, without the nav, the sidebar and the search index.
export const prerender = true;
export const getStaticPaths: GetStaticPaths = async () =>
  (await pages()).map((page) => ({ params: { slug: page.id }, props: { page } }));
export const GET: APIRoute<{ page: DocsPage }> = ({ props }) =>
  new Response(renderMarkdown(props.page), {
    headers: { "Content-Type": "text/markdown; charset=utf-8" },
  });
