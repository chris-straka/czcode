import type { APIRoute } from "astro";

import { buildCzProjectFileJsonSchema } from "@cz/shared/czProjectFile";

// Rendered at build time; published at https://cz.ccez.uk/schema/cz.json so
// cz.json files can reference it via "$schema" for editor/LSP support.
export const GET: APIRoute = () =>
  new Response(`${JSON.stringify(buildCzProjectFileJsonSchema(), null, 2)}\n`, {
    headers: { "Content-Type": "application/json" },
  });
