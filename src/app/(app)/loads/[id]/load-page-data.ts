import "server-only";
import { cache } from "react";
import { loadRepository } from "@/server/intake";
import { getCurrentBrokerage } from "@/server/tenant";

/**
 * The load that both a page and its `generateMetadata` need, read once.
 *
 * The browser tab has to name the load — two loads open in two tabs are
 * otherwise indistinguishable — and metadata runs in the same request as the
 * page body, so `cache` is what stops that costing a second query.
 *
 * `getCurrentBrokerage` rather than `requireBrokerage`: metadata generation is
 * not the place to throw at a signed-out request, and the page beneath it
 * still calls `requireBrokerage` for its own scope. Scoped read either way, so
 * another brokerage's load is indistinguishable from one that does not exist.
 */
export const loadForPage = cache(async (id: string) => {
  const scope = await getCurrentBrokerage();
  if (!scope) return null;
  return await loadRepository.findById(scope, id);
});
