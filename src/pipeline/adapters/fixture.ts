// Fixture adapters: recorded sources and canned drafts, for local runs (`--adapters fixture`).
// The source adapter serves a recorded snapshot, and only links in that snapshot "resolve".
// The writer returns the canned drafts of the types the run asks for. Nothing here touches the network or Claude.
import { readFile } from "node:fs/promises";
import type { ContentWriter, DraftEntry, InjuryReportEntry, JobType, NflverseStats, OfficialVideo, ScheduledGame, SourceAdapter, SourceDocument } from "../types";

interface Fixture {
  documents: SourceDocument[];
  injuryReport?: InjuryReportEntry[];
  schedule?: ScheduledGame[];
  stats?: NflverseStats;
  videos?: OfficialVideo[];
  drafts: DraftEntry[];
}

const FIXTURES: Record<JobType, URL> = {
  "daily-news": new URL("./fixtures/daily-news.json", import.meta.url),
  "thursday-preview": new URL("./fixtures/thursday-preview.json", import.meta.url),
  offseason: new URL("./fixtures/offseason.json", import.meta.url),
  "post-game": new URL("./fixtures/post-game.json", import.meta.url),
  "film-room": new URL("./fixtures/film-room.json", import.meta.url),
};

async function loadFixture(job: JobType): Promise<Fixture> {
  return JSON.parse(await readFile(FIXTURES[job], "utf8"));
}

export async function fixtureAdapters(job: JobType): Promise<{ sources: SourceAdapter; writer: ContentWriter }> {
  const fixture = await loadFixture(job);
  const known = new Set(fixture.documents.map((doc) => doc.url));
  return {
    sources: {
      collect: async ({ date }) => ({
        date,
        documents: fixture.documents,
        injuryReport: fixture.injuryReport,
        ...(fixture.schedule && { schedule: fixture.schedule }),
        ...(fixture.stats && { stats: fixture.stats }),
        ...(fixture.videos && { videos: fixture.videos }),
      }),
      linkResolves: async (url) => known.has(url),
    },
    // Only the drafts of the types the run asks for (a Game Preview in a Game Week, ...).
    writer: { write: async (job) => fixture.drafts.filter((draft) => job.contentTypes?.includes(draft.type) ?? true) },
  };
}
