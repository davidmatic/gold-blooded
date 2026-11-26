// The real Thursday preview sources, driven through their SourceAdapter interface with a fake
// page fetcher and a fake news collector. No network.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { previewSources } from "../../src/pipeline/adapters/real/preview-sources";
import { SCHEDULE_URL } from "../../src/pipeline/adapters/real/schedule";
import type { FetchPage } from "../../src/pipeline/adapters/real/sources";
import { fakeSources, recordedSnapshot } from "../support/fakes";

const csv = readFileSync(new URL("../fixtures/sources/nflverse-games-excerpt.csv", import.meta.url), "utf8");
const news = recordedSnapshot("daily-news-2026-11-25");
const job = { type: "thursday-preview" as const, date: "2026-11-26" };

const serving =
  (pages: Record<string, { status: number; body: string }>): FetchPage =>
  async (url) =>
    pages[url] ?? { status: 404, body: "Not found" };

describe("real sources: the Thursday preview snapshot", () => {
  it("adds the 49ers' nflverse schedule to the day's news and injury report", async () => {
    const sources = previewSources({ fetchPage: serving({ [SCHEDULE_URL]: { status: 200, body: csv } }), news: fakeSources(news) });
    const snapshot = await sources.collect(job);

    expect(snapshot.date).toBe("2026-11-26");
    expect(snapshot.documents).toEqual(news.documents);
    expect(snapshot.injuryReport).toEqual(news.injuryReport);
    expect(snapshot.schedule?.map((game) => game.gameId)).toContain("2026_12_SEA_SF");
  });

  it("fails the run when the schedule can't be fetched", async () => {
    const sources = previewSources({ fetchPage: serving({}), news: fakeSources(news) });

    await expect(sources.collect(job)).rejects.toThrow(/nflverse schedule.*HTTP 404/);
  });
});
