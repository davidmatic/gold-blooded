// Publish check: every source an entry cites (a News Summary's sources, a Film Room entry's
// link to the original) must load.
// The only check that touches the network, and it does so through the source adapter.
import { citedUrls, type PublishCheck } from "./check";

export const sourceLinksResolve: PublishCheck = async ({ entries, sources }) => {
  const cited = entries.flatMap((entry) => citedUrls(entry).map((url) => ({ entry: entry.path, url })));
  const results = await Promise.all(cited.map(async (link) => ({ ...link, ok: await sources.linkResolves(link.url) })));
  return results
    .filter((link) => !link.ok)
    .map((link) => ({ check: "source-links", entry: link.entry, reason: `source link does not load: ${link.url}` }));
};
