// The real Thursday preview sources, driven through their SourceAdapter interface with a fake
// page fetcher and a fake news collector. No network.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { thursdayPreviewSources } from "../../src/pipeline/adapters/real/thursday-preview-sources";
import { statsUrls } from "../../src/pipeline/adapters/real/nflverse-stats";
import { SCHEDULE_URL } from "../../src/pipeline/adapters/real/schedule";
import type { FetchPage } from "../../src/pipeline/adapters/real/sources";
import { fakeSources, recordedSnapshot } from "../support/fakes";

const csv = readFileSync(new URL("../fixtures/sources/nflverse-games-excerpt.csv", import.meta.url), "utf8");
const playerStats = readFileSync(new URL("../fixtures/sources/nflverse-stats-player-week-2026-excerpt.csv", import.meta.url), "utf8");
const teamStats = readFileSync(new URL("../fixtures/sources/nflverse-stats-team-week-2026-excerpt.csv", import.meta.url), "utf8");
const nflverse = {
  [SCHEDULE_URL]: { status: 200, body: csv },
  [statsUrls(2026).players]: { status: 200, body: playerStats },
  [statsUrls(2026).teams]: { status: 200, body: teamStats },
};
const news = recordedSnapshot("daily-news-2026-11-25");
const job = { type: "thursday-preview" as const, date: "2026-11-26" };

const serving =
  (pages: Record<string, { status: number; body: string }>): FetchPage =>
  async (url) =>
    pages[url] ?? { status: 404, body: "Not found" };

describe("real sources: the Thursday preview snapshot", () => {
  it("adds the 49ers' nflverse schedule to the day's news and injury report", async () => {
    const sources = thursdayPreviewSources({ fetchPage: serving({ [SCHEDULE_URL]: { status: 200, body: csv } }), news: fakeSources(news) });
    const snapshot = await sources.collect(job);

    expect(snapshot.date).toBe("2026-11-26");
    expect(snapshot.documents).toEqual(news.documents);
    expect(snapshot.injuryReport).toEqual(news.injuryReport);
    expect(snapshot.schedule?.map((game) => game.gameId)).toContain("2026_12_SEA_SF");
  });

  it("adds the season's nflverse player and team stats, one line per player or team per game", async () => {
    const sources = thursdayPreviewSources({ fetchPage: serving(nflverse), news: fakeSources(news) });
    const snapshot = await sources.collect(job);

    const purdy = snapshot.stats?.players.find((line) => line.player === "Brock Purdy" && line.week === 5);
    expect(purdy).toEqual({
      playerId: "00-0037834",
      player: "Brock Purdy",
      position: "QB",
      season: 2026,
      week: 5,
      seasonType: "REG",
      gameId: "2026_05_SF_SEA",
      team: "SF",
      opponent: "SEA",
      stats: expect.objectContaining({ completions: 19, attempts: 29, passing_yards: 189, passing_epa: -0.0501561768530321, def_sacks: 0 }),
    });
    // NA cells (Warner's passing EPA) are left out, not read as zero.
    const warner = snapshot.stats?.players.find((line) => line.player === "Fred Warner" && line.week === 2);
    expect(warner?.stats).not.toHaveProperty("passing_epa");
    expect(warner?.stats).toMatchObject({ def_tackles_solo: 1, def_sacks: 0.5 });

    expect(snapshot.stats?.teams.filter((line) => line.team === "SF")).toHaveLength(10);
    expect(snapshot.stats?.teams.find((line) => line.team === "SEA" && line.week === 10)).toMatchObject({
      gameId: "2026_10_SEA_LV",
      opponent: "LV",
      stats: { passing_yards: 240 },
    });
  });

  it("records the stats as missing, and carries on, before the season's first stats are out", async () => {
    const sources = thursdayPreviewSources({ fetchPage: serving({ [SCHEDULE_URL]: { status: 200, body: csv } }), news: fakeSources(news) });
    const snapshot = await sources.collect(job);

    expect(snapshot.stats).toEqual({ players: [], teams: [] });
    expect(snapshot.skipped).toContainEqual({ outlet: "nflverse stats", reason: "no 2026 stats yet (HTTP 404)" });
  });

  it("collects no stats in the Offseason", async () => {
    const sources = thursdayPreviewSources({ fetchPage: serving(nflverse), news: fakeSources(news) });
    const snapshot = await sources.collect({ type: "thursday-preview", date: "2026-03-12" });

    expect(snapshot.stats).toBeUndefined();
  });

  it("fails the run when the stats fetch fails for another reason", async () => {
    const sources = thursdayPreviewSources({ fetchPage: serving({ ...nflverse, [statsUrls(2026).teams]: { status: 500, body: "" } }), news: fakeSources(news) });

    await expect(sources.collect(job)).rejects.toThrow(/nflverse team stats.*HTTP 500/);
  });

  it("fails the run when the schedule can't be fetched", async () => {
    const sources = thursdayPreviewSources({ fetchPage: serving({}), news: fakeSources(news) });

    await expect(sources.collect(job)).rejects.toThrow(/nflverse schedule.*HTTP 404/);
  });
});
