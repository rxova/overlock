import type { APIRoute } from "astro";
import { llmsFull } from "@rxova/docs-kit";
import { llms, pages } from "../lib/docs";

// Every page inlined, for when one fetch should be the whole documentation set.
// `rxova-docs-kit check-md-routes` holds it to a size budget.
export const prerender = true;
export const GET: APIRoute = async () =>
  new Response(llmsFull(await pages(), llms), {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
