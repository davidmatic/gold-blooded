// Fixture adapters for the scheduled workflows until the real ones land (#4).
// The source adapter serves a recorded snapshot, and only links in that snapshot "resolve".
// The writer returns canned drafts. Nothing here touches the network or Claude.
import { readFile } from "node:fs/promises";
import type { ContentWriter, DraftEntry, InjuryReportEntry, JobType, SourceAdapter, SourceDocument } from "../types";

interface Fixture {
  documents: SourceDocument[];
  injuryReport?: InjuryReportEntry[];
  drafts: DraftEntry[];
}

const FIXTURES: Partial<Record<JobType, URL>> = {
  "daily-news": new URL("./fixtures/daily-news.json", import.meta.url),
};

async function loadFixture(job: JobType): Promise<Fixture> {
  const file = FIXTURES[job];
  if (!file) throw new Error(`no fixture for job type "${job}"`);
  return JSON.parse(await readFile(file, "utf8"));
}

export async function fixtureAdapters(job: JobType): Promise<{ sources: SourceAdapter; writer: ContentWriter }> {
  const fixture = await loadFixture(job);
  const known = new Set(fixture.documents.map((doc) => doc.url));
  return {
    sources: {
      collect: async ({ date }) => ({ date, documents: fixture.documents, injuryReport: fixture.injuryReport }),
      linkResolves: async (url) => known.has(url),
    },
    writer: { write: async () => fixture.drafts },
  };
}
