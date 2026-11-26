// Publish check: a News Summary that cites a podcast episode must credit the opinion to the
// show and its host ("On 49ers Talk, Maiocco says..."). The body must name the show, and at
// least one host in full or by surname. Pure: it reads only the entries and the snapshot.
import type { CheckFailure, PodcastCredit } from "../types";
import type { PublishCheck } from "./check";

export const podcastsAttributed: PublishCheck = async ({ entries, snapshot }) => {
  const podcasts = new Map<string, PodcastCredit>();
  for (const doc of snapshot.documents) if (doc.podcast) podcasts.set(doc.url, doc.podcast);

  return entries.flatMap((entry) =>
    entry.data.sources.flatMap((source): CheckFailure[] => {
      const credit = podcasts.get(source.url);
      if (!credit) return [];
      const body = comparable(entry.body);
      const fail = (missing: string): CheckFailure[] => [
        { check: "podcast-attribution", entry: entry.path, reason: `cites a ${credit.show} episode (${source.url}) but doesn't name ${missing}` },
      ];
      if (!body.includes(comparable(credit.show))) return fail("the show");
      const namesHost = credit.hosts.some((host) => [host, host.split(/\s+/).at(-1)!].some((name) => body.includes(comparable(name))));
      return namesHost ? [] : fail(`a host (${credit.hosts.join(", ")})`);
    }),
  );
};

/** Case and curly apostrophes don't matter ("Jonnydel’s" names "Jonnydel's"). */
function comparable(text: string): string {
  return text.replace(/[‘’]/g, "'").toLowerCase();
}
