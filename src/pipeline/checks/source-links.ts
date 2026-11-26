// Publish check: every source a News Summary cites must load.
// The only check that touches the network, and it does so through the source adapter.
import type { PublishCheck } from "./check";

export const sourceLinksResolve: PublishCheck = async ({ entries, sources }) => {
  const cited = entries.flatMap((entry) => (("sources" in entry.data && entry.data.sources) || []).map((source) => ({ entry: entry.path, url: source.url })));
  const results = await Promise.all(cited.map(async (link) => ({ ...link, ok: await sources.linkResolves(link.url) })));
  return results
    .filter((link) => !link.ok)
    .map((link) => ({ check: "source-links", entry: link.entry, reason: `source link does not load: ${link.url}` }));
};
