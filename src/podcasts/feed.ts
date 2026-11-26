// Pure parsers for podcast RSS feeds and the Apple Podcasts episode lookup.
import { XMLParser } from "fast-xml-parser";
import { parse as parseHtml } from "node-html-parser";
import { parseFeedDate } from "../pipeline/adapters/real/parsers";

/** One episode as its feed lists it. */
export interface FeedEpisode {
  guid: string;
  title: string;
  /** ISO 8601, UTC. */
  publishedAt: string;
  audioUrl: string;
  /** The episode's own web page, when the feed gives one (Buzzsprout does, Simplecast doesn't). */
  pageUrl?: string;
  durationSeconds?: number;
  /** The show notes, as plain text. */
  description: string;
}

const xml = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  processEntities: true,
  htmlEntities: true,
  parseTagValue: false,
  isArray: (name) => name === "item",
});

/** A podcast RSS feed's episodes, newest first. Items without a guid, audio, or date are skipped. */
export function parsePodcastFeed(feed: string): FeedEpisode[] {
  const items: Record<string, unknown>[] = xml.parse(feed)?.rss?.channel?.item ?? [];
  const episodes = items.flatMap((item): FeedEpisode[] => {
    const guid = text(item.guid);
    const audioUrl = attribute(item.enclosure, "url");
    const publishedAt = parseFeedDate(text(item.pubDate));
    if (!guid || !audioUrl || !publishedAt) return [];
    const durationSeconds = parseDuration(text(item["itunes:duration"]));
    const pageUrl = buzzsproutPage(guid, audioUrl);
    return [
      {
        guid,
        title: plain(text(item.title)),
        publishedAt,
        audioUrl,
        ...(pageUrl && { pageUrl }),
        ...(durationSeconds !== undefined && { durationSeconds }),
        description: plain(text(item.description) || text(item["content:encoded"])),
      },
    ];
  });
  return episodes.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
}

/** Apple Podcasts episode pages by episode guid, from the lookup API's JSON. */
export function parseAppleLookup(json: string): Map<string, string> {
  const results: { wrapperType?: string; episodeGuid?: string; trackViewUrl?: string }[] = JSON.parse(json).results ?? [];
  const pages = new Map<string, string>();
  for (const result of results) {
    if (result.wrapperType !== "podcastEpisode" || !result.episodeGuid || !result.trackViewUrl) continue;
    const url = new URL(result.trackViewUrl);
    url.searchParams.delete("uo"); // Apple's affiliate tag, not part of the page.
    pages.set(result.episodeGuid, url.href);
  }
  return pages;
}

/** `HH:MM:SS`, `MM:SS`, or plain seconds (feeds differ). */
export function parseDuration(value: string): number | undefined {
  if (!/^\d+(:\d{1,2}){0,2}$/.test(value)) return undefined;
  return value.split(":").reduce((total, part) => total * 60 + Number(part), 0);
}

/** Buzzsprout episodes have a page at /<show>/episodes/<id>; the guid is `Buzzsprout-<id>`. */
function buzzsproutPage(guid: string, audioUrl: string): string | undefined {
  const id = guid.match(/^Buzzsprout-(\d+)$/)?.[1];
  const show = audioUrl.match(/^https:\/\/www\.buzzsprout\.com\/(\d+)\/episodes\//)?.[1];
  return id && show ? `https://www.buzzsprout.com/${show}/episodes/${id}` : undefined;
}

function text(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number") return String(value);
  if (value && typeof value === "object" && "#text" in value) return text((value as { "#text": unknown })["#text"]);
  return "";
}

function attribute(value: unknown, name: string): string {
  return value && typeof value === "object" ? text((value as Record<string, unknown>)[`@_${name}`]) : "";
}

function plain(html: string): string {
  return parseHtml(html.replace(/<br\s*\/?>/gi, " ").replace(/<\/p>/gi, " </p>")).text.replace(/\s+/g, " ").trim();
}
