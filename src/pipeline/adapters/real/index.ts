// The real adapters: Preferred Sources over the network, and the Claude writer.
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { ContentWriter, JobType, SourceAdapter } from "../../types";
import { claudePreviewWriter } from "./claude-preview-writer";
import { claudeWriter } from "./claude-writer";
import { podcastTranscripts, transcriptCacheDir, whisperTranscriber, type PodcastTranscripts } from "../../../podcasts";
import { previewSources } from "./preview-sources";
import { claudeOffseasonWriter } from "./claude-offseason-writer";
import { claudePostGameWriter } from "./claude-post-game-writer";
import { postGameSources } from "./post-game-sources";
import { offseasonSources } from "./offseason-sources";
import { BOT_USER_AGENT, fetchWithBotUserAgent, realSources } from "./sources";

export { BOT_USER_AGENT, realSources, SOURCE_URLS } from "./sources";
export { MODEL, SpendLimitReachedError } from "./claude";
export { claudeWriter } from "./claude-writer";
export { claudePreviewWriter } from "./claude-preview-writer";
export { previewSources } from "./preview-sources";
export { claudeOffseasonWriter } from "./claude-offseason-writer";
export { offseasonSources } from "./offseason-sources";
export { claudePostGameWriter } from "./claude-post-game-writer";
export { postGameSources } from "./post-game-sources";

export async function realAdapters(
  job: JobType,
  contentDir: string,
): Promise<{ sources: SourceAdapter; writer: ContentWriter }> {
  if (job === "thursday-preview") return { sources: previewSources(), writer: claudePreviewWriter() };
  if (job === "offseason") return { sources: offseasonSources({ contentDir }), writer: claudeOffseasonWriter() };
  if (job === "post-game") return { sources: postGameSources(), writer: claudePostGameWriter() };
  if (job !== "daily-news") throw new Error(`no real adapters for job type "${job}" yet`);
  return {
    sources: realSources({ alreadyCited: await citedSourceUrls(contentDir), podcasts: realPodcastTranscripts() }),
    writer: claudeWriter(),
  };
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
