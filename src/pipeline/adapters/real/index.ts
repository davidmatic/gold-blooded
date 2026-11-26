// The real adapters: Preferred Sources over the network, and the Claude writer.
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { ContentWriter, JobType, SourceAdapter } from "../../types";
import { claudeGamePreviewWriter } from "./claude-game-preview-writer";
import { claudeWriter } from "./claude-writer";
import { podcastTranscripts, transcriptCacheDir, whisperTranscriber, type PodcastTranscripts } from "../../../podcasts";
import { thursdayPreviewSources } from "./thursday-preview-sources";
import { claudeOffseasonWriter } from "./claude-offseason-writer";
import { claudePostGameWriter } from "./claude-post-game-writer";
import { postGameSources } from "./post-game-sources";
import { offseasonSources } from "./offseason-sources";
import { BOT_USER_AGENT, fetchWithBotUserAgent, realSources } from "./sources";
import { filmRoomSources } from "./film-room-sources";
import { claudeFilmRoomWriter } from "./claude-film-room-writer";
import { ytDlpCaptions } from "./captions";

export { BOT_USER_AGENT, realSources, SOURCE_URLS } from "./sources";
export { MODEL, ROUTINE_MODEL, SpendLimitReachedError } from "./claude";
export { claudeWriter } from "./claude-writer";
export { claudeGamePreviewWriter } from "./claude-game-preview-writer";
export { thursdayPreviewSources } from "./thursday-preview-sources";
export { claudeOffseasonWriter } from "./claude-offseason-writer";
export { offseasonSources } from "./offseason-sources";
export { claudePostGameWriter } from "./claude-post-game-writer";
export { postGameSources } from "./post-game-sources";
export { filmRoomSources } from "./film-room-sources";
export { claudeFilmRoomWriter } from "./claude-film-room-writer";
export { ytDlpCaptions } from "./captions";

type Adapters = { sources: SourceAdapter; writer: ContentWriter };

/** Each job's real sources and writer. */
const REAL_ADAPTERS: Record<JobType, (contentDir: string) => Adapters | Promise<Adapters>> = {
  "daily-news": async (contentDir) => ({
    sources: realSources({ alreadyCited: await citedSourceUrls(contentDir), podcasts: realPodcastTranscripts() }),
    writer: claudeWriter(),
  }),
  "thursday-preview": () => ({ sources: thursdayPreviewSources(), writer: claudeGamePreviewWriter() }),
  offseason: (contentDir) => ({ sources: offseasonSources({ contentDir }), writer: claudeOffseasonWriter() }),
  "post-game": (contentDir) => ({ sources: postGameSources({ contentDir }), writer: claudePostGameWriter() }),
  "film-room": (contentDir) => ({
    sources: filmRoomSources({ contentDir, podcasts: realPodcastTranscripts(), captions: ytDlpCaptions() }),
    writer: claudeFilmRoomWriter(),
  }),
};

export async function realAdapters(job: JobType, contentDir: string): Promise<Adapters> {
  return REAL_ADAPTERS[job](contentDir);
}

/** Podcast transcripts from the real feeds, transcribed with Whisper and cached in the repo. */
export function realPodcastTranscripts(log?: (message: string) => void): PodcastTranscripts {
  return podcastTranscripts({
    fetchPage: fetchWithBotUserAgent,
    transcriber: whisperTranscriber({ userAgent: BOT_USER_AGENT, ...(log && { log }) }),
    cacheDir: transcriptCacheDir(),
    ...(log && { log }),
  });
}

/** Source URLs that published News Summaries already cite, so the same article isn't summarised twice. */
async function citedSourceUrls(contentDir: string): Promise<string[]> {
  const newsDir = path.join(contentDir, "news");
  const files = await readdir(newsDir).catch(() => [] as string[]);
  const texts = await Promise.all(files.filter((f) => f.endsWith(".md")).map((f) => readFile(path.join(newsDir, f), "utf8")));
  return texts.flatMap((text) => [...text.matchAll(/^\s*-?\s*url:\s*"([^"]+)"/gm)].map((match) => match[1]!));
}
