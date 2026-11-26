// Podcast fetch-and-transcribe, with a transcript cache: the reusable unit behind podcast
// News Summaries (daily news) and JFA Film Room entries.
//
// latest() reads a show's RSS feed, picks its newest episodes in a time window, and returns
// each with its transcript. A transcript is read from the cache when the episode has one;
// otherwise the transcriber (Whisper on the runner, or a fake in tests) makes it and the cache
// keeps it, so an episode is transcribed only once. The cache is a folder of JSON files, one
// per episode, committed to the repo (data/transcripts/<show id>/<guid>.json).
//
// All network access goes through `fetchPage`; audio download is the transcriber's business.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseAppleLookup, parsePodcastFeed, type FeedEpisode } from "./feed";
import { appleLookupUrl, type Podcast } from "./shows";

/** Fetches one URL. Throws on a network error; any HTTP status is returned. */
export type FetchPage = (url: string) => Promise<{ status: number; body: string }>;

/** Turns an episode's audio into text. */
export interface Transcriber {
  /** Recorded in the cache with each transcript, e.g. `faster-whisper small.en`. */
  name: string;
  /** `prompt` is the show's vocabulary, so names come out spelled right. */
  transcribe(audio: { audioUrl: string; prompt: string }): Promise<string>;
}

export interface PodcastEpisode {
  podcastId: string;
  show: string;
  hosts: string[];
  guid: string;
  title: string;
  /** ISO 8601, UTC. */
  publishedAt: string;
  /** The episode's own page: the source link to cite. */
  episodeUrl: string;
  audioUrl: string;
  durationSeconds?: number;
  /** The show notes, as plain text. */
  description: string;
  /** The full transcript. Absent when transcription failed; `transcriptError` says why. */
  transcript?: string;
  transcriptError?: string;
}

export interface LatestOptions {
  /** Most episodes to return, newest first. */
  limit: number;
  /** Only episodes published at or after this instant (ISO 8601). */
  from?: string;
  /** Only episodes published before this instant (ISO 8601). */
  to?: string;
  /** Episode page URLs to leave out (e.g. ones published content already cites). */
  exclude?: Iterable<string>;
}

export interface PodcastTranscriptsOptions {
  fetchPage: FetchPage;
  transcriber: Transcriber;
  /** The transcript cache folder. */
  cacheDir: string;
  log?: (message: string) => void;
}

export interface PodcastTranscripts {
  /**
   * The show's newest episodes in the window, each with its transcript when one could be made.
   * Throws when the feed itself can't be fetched; a failed transcription only marks its episode.
   */
  latest(podcast: Podcast, options: LatestOptions): Promise<PodcastEpisode[]>;
}

/** What the cache keeps per episode. */
interface CachedTranscript {
  guid: string;
  show: string;
  title: string;
  publishedAt: string;
  episodeUrl: string;
  audioUrl: string;
  transcribedWith: string;
  text: string;
}

export function podcastTranscripts(options: PodcastTranscriptsOptions): PodcastTranscripts {
  const { fetchPage, transcriber, cacheDir } = options;
  const log = options.log ?? ((message: string) => console.log(message));

  async function load(url: string): Promise<string> {
    const page = await fetchPage(url);
    if (page.status < 200 || page.status > 299) throw new Error(`HTTP ${page.status} from ${url}`);
    return page.body;
  }

  /** The Apple Podcasts page of each listed episode, or none when the lookup fails. */
  async function applePages(podcast: Podcast): Promise<Map<string, string>> {
    if (!podcast.appleId) return new Map();
    try {
      return parseAppleLookup(await load(appleLookupUrl(podcast.appleId)));
    } catch (error) {
      log(`${podcast.show}: Apple Podcasts lookup failed (${message(error)}); linking to the audio instead`);
      return new Map();
    }
  }

  function cacheFile(podcast: Podcast, guid: string): string {
    return path.join(cacheDir, podcast.id, `${guid.replace(/[^A-Za-z0-9._-]/g, "_")}.json`);
  }

  async function cached(podcast: Podcast, guid: string): Promise<string | undefined> {
    try {
      const entry: CachedTranscript = JSON.parse(await readFile(cacheFile(podcast, guid), "utf8"));
      return entry.guid === guid && entry.text ? entry.text : undefined;
    } catch {
      return undefined;
    }
  }

  async function transcribe(podcast: Podcast, episode: PodcastEpisode): Promise<PodcastEpisode> {
    const hit = await cached(podcast, episode.guid);
    if (hit) return { ...episode, transcript: hit };
    try {
      log(`${podcast.show}: transcribing "${episode.title}"`);
      const text = (await transcriber.transcribe({ audioUrl: episode.audioUrl, prompt: podcast.vocabulary })).trim();
      if (!text) throw new Error("the transcript came back empty");
      const entry: CachedTranscript = {
        guid: episode.guid,
        show: podcast.show,
        title: episode.title,
        publishedAt: episode.publishedAt,
        episodeUrl: episode.episodeUrl,
        audioUrl: episode.audioUrl,
        transcribedWith: transcriber.name,
        text,
      };
      const file = cacheFile(podcast, episode.guid);
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, `${JSON.stringify(entry, null, 2)}\n`);
      return { ...episode, transcript: text };
    } catch (error) {
      log(`${podcast.show}: could not transcribe "${episode.title}" (${message(error)})`);
      return { ...episode, transcriptError: message(error) };
    }
  }

  return {
    async latest(podcast, { limit, from, to, exclude }) {
      const excluded = new Set(exclude ?? []);
      const inWindow = parsePodcastFeed(await load(podcast.feedUrl)).filter(
        (item) => (!from || item.publishedAt >= iso(from)) && (!to || item.publishedAt < iso(to)),
      );
      const pages = inWindow.some((item) => !item.pageUrl) ? await applePages(podcast) : new Map<string, string>();
      const episodes = inWindow
        .map((item) => toEpisode(podcast, item, item.pageUrl ?? pages.get(item.guid) ?? item.audioUrl))
        .filter((episode) => !excluded.has(episode.episodeUrl))
        .slice(0, limit);
      // One at a time: transcription is CPU-bound on the runner.
      const results: PodcastEpisode[] = [];
      for (const episode of episodes) results.push(await transcribe(podcast, episode));
      return results;
    },
  };
}

function toEpisode(podcast: Podcast, item: FeedEpisode, episodeUrl: string): PodcastEpisode {
  return {
    podcastId: podcast.id,
    show: podcast.show,
    hosts: [...podcast.hosts],
    guid: item.guid,
    title: item.title,
    publishedAt: item.publishedAt,
    episodeUrl,
    audioUrl: item.audioUrl,
    ...(item.durationSeconds !== undefined && { durationSeconds: item.durationSeconds }),
    description: item.description,
  };
}

/** Normalised so string comparison orders instants. */
function iso(instant: string): string {
  return new Date(instant).toISOString();
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
