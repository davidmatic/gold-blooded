// The podcasts Gold Blooded transcribes (Preferred Sources in GLOSSARY.md).

export interface Podcast {
  /** Stable id, used as the transcript cache folder name. */
  id: string;
  /** The show's name as fans know it, used for attribution ("On 49ers Talk, ..."). */
  show: string;
  hosts: string[];
  feedUrl: string;
  /**
   * The show's Apple Podcasts id. When the feed has no per-episode web page, the episode's
   * Apple Podcasts page (matched by guid) is its source link.
   */
  appleId?: number;
  /** Names and terms Whisper should spell right; passed as its initial prompt. */
  vocabulary: string;
}

const ROSTER =
  "San Francisco 49ers, Niners, Brock Purdy, Kyle Shanahan, John Lynch, Christian McCaffrey, George Kittle, " +
  "Fred Warner, Nick Bosa, Brandon Aiyuk, Trent Williams, Levi's Stadium";

export const PODCASTS = {
  ninersTalk: {
    id: "49ers-talk",
    show: "49ers Talk",
    hosts: ["Matt Maiocco", "Jennifer Lee Chan"],
    feedUrl: "https://feeds.simplecast.com/SCmnvidR",
    appleId: 1153457233,
    vocabulary: `49ers Talk with Matt Maiocco and Jennifer Lee Chan. ${ROSTER}.`,
  },
  jfa: {
    id: "jfa",
    show: "Jonnydel's Football Academy",
    hosts: ["Jonnydel"],
    feedUrl: "https://rss.buzzsprout.com/2047939.rss",
    vocabulary: `Jonnydel's Football Academy, JFA, Jonnydel. ${ROSTER}.`,
  },
} as const satisfies Record<string, Podcast>;

/** The Apple Podcasts lookup that lists a show's recent episodes with their guids and pages. */
export function appleLookupUrl(appleId: number): string {
  return `https://itunes.apple.com/lookup?id=${appleId}&entity=podcastEpisode&limit=25`;
}
