// The real adapters: Preferred Sources over the network, and the Claude writer.
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { ContentWriter, JobType, SourceAdapter } from "../../types";
import { claudeWriter } from "./claude-writer";
import { realSources } from "./sources";

export { BOT_USER_AGENT, realSources, SOURCE_URLS } from "./sources";
export { claudeWriter, MODEL, SpendLimitReachedError } from "./claude-writer";

export async function realAdapters(
  job: JobType,
  contentDir: string,
): Promise<{ sources: SourceAdapter; writer: ContentWriter }> {
  if (job !== "daily-news") throw new Error(`no real adapters for job type "${job}" yet`);
  return {
    sources: realSources({ alreadyCited: await citedSourceUrls(contentDir) }),
    writer: claudeWriter(),
  };
}

/** Source URLs that published News Summaries already cite, so the same article isn't summarised twice. */
async function citedSourceUrls(contentDir: string): Promise<string[]> {
  const newsDir = path.join(contentDir, "news");
  const files = await readdir(newsDir).catch(() => [] as string[]);
  const texts = await Promise.all(files.filter((f) => f.endsWith(".md")).map((f) => readFile(path.join(newsDir, f), "utf8")));
  return texts.flatMap((text) => [...text.matchAll(/^\s*-?\s*url:\s*"([^"]+)"/gm)].map((match) => match[1]!));
}
