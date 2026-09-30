import type { APIRoute } from "astro";
import { llmsIndex } from "@rxova/docs-kit";
import { llms, pages, preamble } from "../lib/docs";

// The agent-facing index. The mount, not the bare origin: under the aggregator
// this site lives at /packages/overlock/.
export const prerender = true;
export const GET: APIRoute = async () =>
  new Response(
    llmsIndex(await pages(), {
      ...llms,
      mount: `${import.meta.env.SITE}${import.meta.env.BASE_URL}`,
      preamble,
    }),
    { headers: { "Content-Type": "text/plain; charset=utf-8" } },
  );
