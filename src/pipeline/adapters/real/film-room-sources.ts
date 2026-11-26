// The real sources for the Film Room job: the week's new breakdowns from The QB School (YouTube)
// and Jonnydel's Football Academy (the podcast), one document each, marked with `film`.
//
// - The QB School: its channel's RSS feed (the 15 newest videos, no API key), keeping videos
//   about the 49ers (the channel covers every quarterback). Captions are best effort, since
//   YouTube often blocks cloud runners: when they can't be had, the video's description is its
//   text, `film.transcribed` is false, and the run goes on (listed in `skipped`).
// - Jonnydel's Football Academy: the newest episodes through the podcast transcription unit
//   (src/podcasts/), which shares its transcript cache with the daily news, so an episode is
//   transcribed once. An episode that can't be transcribed falls back to its show notes.
//
// Breakdowns that already have a Film Room entry (by the entry's `link`) are left out, so each
// one is summarised once. A feed that won't load is skipped, and the run goes on without it.
import { readdir } from "node:fs/promises";
import path from "node:path";
import { PODCASTS, type PodcastTranscripts } from "../../../podcasts";
import { readEntry } from "../../content-store";
import type { Job, SkippedSource, SourceAdapter, SourceDocument, SourceSnapshot } from "../../types";
import { vttToText } from "./captions";
import { pacificToUtc } from "./parsers";
import { fetchWithBotUserAgent, type FetchPage } from "./sources";
import { parseYouTubeFeed, youtubeFeedUrl } from "./youtube";

export const QB_SCHOOL = { name: "The QB School", id: "UCGfxHp2yuimtLsFaq1r7aIQ" } as const;
export const QB_SCHOOL_FEED = youtubeFeedUrl(QB_SCHOOL.id);

/** A video's captions as WebVTT. Throws when they can't be had (blocked, none, timed out). */
export type CaptionFetcher = (videoUrl: string) => Promise<string>;

export interface FilmRoomSourcesOptions {
  /** The content folder; breakdowns its Film Room entries already link to are left out. */
  contentDir?: string;
  fetchPage?: FetchPage;
  /** JFA episodes and their transcripts. */
  podcasts: PodcastTranscripts;
  /** QB School captions (yt-dlp on the runner). */
  captions: CaptionFetcher;
  log?: (message: string) => void;
}

/** How far back a run looks, so a missed day's breakdowns are still picked up. */
const WINDOW_DAYS = 7;
const MAX_VIDEOS = 3;
const MAX_EPISODES = 2;

/** The QB School covers every quarterback; the Film Room keeps the ones about the 49ers. */
const ABOUT_49ERS = /\b(purdy|49ers|niners|shanahan|san francisco)\b/i;

export function filmRoomSources(options: FilmRoomSourcesOptions): SourceAdapter {
  const fetchPage = options.fetchPage ?? fetchWithBotUserAgent;
  const log = options.log ?? ((message: string) => console.log(message));

  async function videos(from: string, to: string, covered: Set<string>, skipped: SkippedSource[]): Promise<SourceDocument[]> {
    const page = await fetchPage(QB_SCHOOL_FEED);
    if (page.status < 200 || page.status > 299) throw new Error(`HTTP ${page.status}`);
    const fresh = parseYouTubeFeed(page.body, QB_SCHOOL.name)
      .map((video) => ({ ...video, publishedAt: new Date(video.publishedAt).toISOString() }))
      .filter((video) => video.publishedAt >= from && video.publishedAt < to && !covered.has(video.url))
      .filter((video) => ABOUT_49ERS.test(`${video.title}\n${video.description}`))
      .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))
      .slice(0, MAX_VIDEOS);
    const documents: SourceDocument[] = [];
    for (const video of fresh) {
      const captions = await options.captions(video.url).then(vttToText).catch((error: unknown) => error instanceof Error ? error : new Error(String(error)));
      const transcribed = typeof captions === "string" && captions.length > 0;
      if (!transcribed) {
        const reason = `no captions for "${video.title}" (${captions instanceof Error ? captions.message : "the captions were empty"}); using its title and description`;
        log(`${QB_SCHOOL.name}: ${reason}`);
        skipped.push({ outlet: QB_SCHOOL.name, reason });
      }
      documents.push({
        url: video.url,
        outlet: QB_SCHOOL.name,
        title: video.title,
        publishedAt: video.publishedAt,
        text: transcribed ? captions : video.description || video.title,
        film: { show: QB_SCHOOL.name, medium: "video", description: video.description, transcribed },
      });
    }
    return documents;
  }

  async function episodes(from: string, to: string, covered: Set<string>): Promise<SourceDocument[]> {
    const show = PODCASTS.jfa;
    const latest = await options.podcasts.latest(show, { limit: MAX_EPISODES, from, to, exclude: covered });
    return latest.map((episode) => {
      if (!episode.transcript) log(`${show.show}: using the show notes for "${episode.title}" (${episode.transcriptError ?? "no transcript"})`);
      return {
        url: episode.episodeUrl,
        outlet: show.show,
        title: episode.title,
        publishedAt: episode.publishedAt,
        text: episode.transcript ?? (episode.description || episode.title),
        podcast: { show: show.show, hosts: episode.hosts },
        film: { show: show.show, medium: "podcast", description: episode.description, transcribed: Boolean(episode.transcript) },
      };
    });
  }

  async function bestEffort(outlet: string, skipped: SkippedSource[], collect: () => Promise<SourceDocument[]>): Promise<SourceDocument[]> {
    try {
      return await collect();
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      log(`${outlet}: skipped (${reason})`);
      skipped.push({ outlet, reason });
      return [];
    }
  }

  return {
    async collect(job: Job): Promise<SourceSnapshot> {
      const from = dayStart(addDays(job.date, -WINDOW_DAYS));
      const to = dayStart(addDays(job.date, 1));
      const covered = new Set(options.contentDir ? await filmRoomLinks(options.contentDir) : []);
      const skipped: SkippedSource[] = [];
      // One after the other: Whisper is CPU-bound on the runner.
      const documents = [
        ...(await bestEffort(QB_SCHOOL.name, skipped, () => videos(from, to, covered, skipped))),
        ...(await bestEffort(PODCASTS.jfa.show, skipped, () => episodes(from, to, covered))),
      ];
      return { date: job.date, documents, ...(skipped.length > 0 && { skipped }) };
    },
    async linkResolves(url) {
      try {
        const page = await fetchPage(url);
        return page.status >= 200 && page.status <= 299;
      } catch {
        return false;
      }
    },
  };
}

/** The originals that published Film Room entries link to. */
async function filmRoomLinks(contentDir: string): Promise<string[]> {
  const files = await readdir(path.join(contentDir, "film-room")).catch(() => [] as string[]);
  const entries = await Promise.all(files.filter((file) => file.endsWith(".md")).map((file) => readEntry(contentDir, path.join("film-room", file))));
  return entries.flatMap((entry) => {
    const link = (entry?.data as { link?: unknown } | undefined)?.link;
    return typeof link === "string" ? [link] : [];
  });
}

/** Midnight at the start of a YYYY-MM-DD day, Pacific time, as ISO 8601. */
function dayStart(day: string): string {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  return pacificToUtc(y, m - 1, d).toISOString();
}

function addDays(day: string, days: number): string {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}
