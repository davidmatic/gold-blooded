// Official YouTube videos: the 49ers' and the NFL's channels, read from their public RSS feeds
// (Atom, the 15 newest videos, no API key). These are the only videos content may embed, and
// the official-clips publish check holds every embedded clip to the ones in the snapshot.
import { XMLParser } from "fast-xml-parser";
import type { OfficialVideo, SkippedSource } from "../../types";
import type { FetchPage } from "./sources";

export const OFFICIAL_CHANNELS = {
  niners: { name: "San Francisco 49ers", id: "UCeIOarQkwmGhimim9cDUTng", onlyAbout49ers: false },
  // The NFL's channel posts every team's clips, so only those about the 49ers are kept.
  nfl: { name: "NFL", id: "UCDVYQ4Zhbm3S2dlz7P1GBDg", onlyAbout49ers: true },
} as const;

export type OfficialChannel = (typeof OFFICIAL_CHANNELS)[keyof typeof OFFICIAL_CHANNELS];

export function youtubeFeedUrl(channelId: string): string {
  return `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`;
}

const xml = new XMLParser({ ignoreAttributes: true, processEntities: true, htmlEntities: true, parseTagValue: false, isArray: (name) => name === "entry" });

/** The videos in a channel's YouTube feed, newest first, credited to the channel. */
export function parseYouTubeFeed(body: string, channel: string): OfficialVideo[] {
  const feed = xml.parse(body)?.feed;
  if (!feed) throw new Error("not a YouTube channel feed");
  return ((feed.entry ?? []) as Record<string, unknown>[]).map((entry) => {
    const videoId = String(entry["yt:videoId"] ?? "");
    const group = (entry["media:group"] ?? {}) as Record<string, unknown>;
    return {
      videoId,
      title: String(entry.title ?? ""),
      channel,
      url: `https://www.youtube.com/watch?v=${videoId}`,
      publishedAt: String(entry.published ?? ""),
      description: String(group["media:description"] ?? ""),
    };
  });
}

const ABOUT_49ERS = /49ers|niners/i;

/**
 * The official channels' videos posted since a moment (a game's kickoff). Best effort: a feed that
 * won't load is skipped, and listed as skipped, and the run goes on without its clips.
 */
export async function officialVideosSince(fetchPage: FetchPage, since: string, log: (message: string) => void = () => {}) {
  const videos: OfficialVideo[] = [];
  const skipped: SkippedSource[] = [];
  for (const channel of Object.values(OFFICIAL_CHANNELS)) {
    const outlet = `${channel.name} YouTube`;
    try {
      const page = await fetchPage(youtubeFeedUrl(channel.id));
      if (page.status < 200 || page.status > 299) throw new Error(`HTTP ${page.status}`);
      videos.push(
        ...parseYouTubeFeed(page.body, channel.name).filter(
          (video) => Date.parse(video.publishedAt) >= Date.parse(since) && (!channel.onlyAbout49ers || ABOUT_49ERS.test(`${video.title} ${video.description}`)),
        ),
      );
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      log(`Skipping ${outlet}: ${reason}`);
      skipped.push({ outlet, reason });
    }
  }
  return { videos, skipped };
}
