// The real post-game sources, driven through their SourceAdapter interface with a fake page
// fetcher and a fake news collector. No network.
import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { GamePreviewData } from "../../src/content/game-week";
import type { PredictionRecordData } from "../../src/content/prediction-record";
import { writeEntries } from "../../src/pipeline/content-store";
import { statsUrls } from "../../src/pipeline/adapters/real/nflverse-stats";
import { postGameSources } from "../../src/pipeline/adapters/real/post-game-sources";
import { SCHEDULE_URL } from "../../src/pipeline/adapters/real/schedule";
import type { FetchPage } from "../../src/pipeline/adapters/real/sources";
import { OFFICIAL_CHANNELS, youtubeFeedUrl } from "../../src/pipeline/adapters/real/youtube";
import type { Job } from "../../src/pipeline";
import { fakeSources, recordedSnapshot } from "../support/fakes";

const fixture = (name: string) => readFileSync(new URL(`../fixtures/sources/${name}`, import.meta.url), "utf8");
const ninersFeed = fixture("youtube-49ers-feed.xml");
const NFLVERSE = {
  [SCHEDULE_URL]: { status: 200, body: fixture("nflverse-games-excerpt.csv") },
  [statsUrls(2026).players]: { status: 200, body: fixture("nflverse-stats-player-week-2026-excerpt.csv") },
  [statsUrls(2026).teams]: { status: 200, body: fixture("nflverse-stats-team-week-2026-excerpt.csv") },
};
const YOUTUBE = {
  [youtubeFeedUrl(OFFICIAL_CHANNELS.niners.id)]: { status: 200, body: ninersFeed },
  [youtubeFeedUrl(OFFICIAL_CHANNELS.nfl.id)]: { status: 200, body: fixture("youtube-nfl-feed.xml") },
};
const news = recordedSnapshot("daily-news-2026-11-25");
// The day after the 49ers' Week 11 win over Minnesota (Sunday night, 2026-11-22).
const job: Job = { type: "post-game", date: "2026-11-23" };

/** Serves the given pages (404 for anything else), and remembers every URL asked for. */
function serving(pages: Record<string, { status: number; body: string }>): FetchPage & { asked: string[] } {
  const asked: string[] = [];
  return Object.assign(
    async (url: string) => {
      asked.push(url);
      return pages[url] ?? { status: 404, body: "Not found" };
    },
    { asked },
  );
}

describe("real sources: the post-game snapshot", () => {
  it("the day after a game, adds the day's news, the schedule, the season's nflverse stats, and the official clips", async () => {
    const fetchPage = serving({ ...NFLVERSE, ...YOUTUBE });
    const snapshot = await postGameSources({ fetchPage, news: fakeSources(news) }).collect(job);

    expect(snapshot.date).toBe("2026-11-23");
    expect(snapshot.documents).toEqual(news.documents);
    expect(snapshot.schedule?.find((game) => game.gameId === "2026_11_MIN_SF")?.result).toEqual({ sf: 35, opponent: 10 });
    expect(snapshot.stats?.teams.some((line) => line.gameId === "2026_11_MIN_SF" && line.team === "SF")).toBe(true);
    expect(snapshot.videos).toEqual([
      {
        videoId: "Id7LlG3tijo",
        title: "Mic’d Up: Warner and Kittle Take Over Mexico City | 49ers",
        channel: "San Francisco 49ers",
        url: "https://www.youtube.com/watch?v=Id7LlG3tijo",
        publishedAt: "2026-11-26T01:00:06+00:00",
        description: expect.stringContaining("wired for sound during the team’s Week 11 matchup against the Minnesota Vikings"),
      },
      expect.objectContaining({ videoId: "QYhSfNeQ5QE", channel: "San Francisco 49ers" }),
      expect.objectContaining({ videoId: "jsOA0SpFHM4", title: "San Francisco 49ers vs. Minnesota Vikings Highlights | Week 11" }),
      // The NFL's channel posts every team's clips: only the ones about the 49ers are kept.
      expect.objectContaining({ videoId: "Nf1Wk11SFmn", channel: "NFL" }),
    ]);
  });

  it("leaves out videos posted before the game kicked off", async () => {
    const older = ninersFeed.replace("<published>2026-11-23T05:34:01+00:00</published>", "<published>2026-11-20T18:00:00+00:00</published>");
    const fetchPage = serving({ ...NFLVERSE, ...YOUTUBE, [youtubeFeedUrl(OFFICIAL_CHANNELS.niners.id)]: { status: 200, body: older } });
    const snapshot = await postGameSources({ fetchPage, news: fakeSources(news) }).collect(job);

    expect(snapshot.videos?.map((video) => video.videoId)).not.toContain("jsOA0SpFHM4");
  });

  it("goes on without a channel's clips when its feed won't load, listing it as skipped", async () => {
    const fetchPage = serving({ ...NFLVERSE, [youtubeFeedUrl(OFFICIAL_CHANNELS.niners.id)]: { status: 500, body: "" } });
    const snapshot = await postGameSources({ fetchPage, news: fakeSources(news), log: () => {} }).collect(job);

    expect(snapshot.videos).toEqual([]);
    expect(snapshot.skipped).toEqual([
      { outlet: "San Francisco 49ers YouTube", reason: "HTTP 500" },
      { outlet: "NFL YouTube", reason: "HTTP 404" },
    ]);
  });

  it("fails the run when nflverse doesn't have the game's stats yet", async () => {
    // Week 12 against Seattle, final here, but the stats excerpt stops at Week 11.
    const played = NFLVERSE[SCHEDULE_URL]!.body.replace(/(2026_12_SEA_SF,[^\n]*?),SEA,,SF,,/, "$1,SEA,20,SF,27,");
    const fetchPage = serving({ ...NFLVERSE, ...YOUTUBE, [SCHEDULE_URL]: { status: 200, body: played } });
    const sources = postGameSources({ fetchPage, news: fakeSources(news) });

    await expect(sources.collect({ type: "post-game", date: "2026-11-30" })).rejects.toThrow(/nflverse has no stats for 2026_12_SEA_SF yet/);
  });

  it("on a day with no game the day before, fetches only the schedule", async () => {
    const fetchPage = serving({ ...NFLVERSE, ...YOUTUBE });
    let newsCollected = false;
    const sources = postGameSources({ fetchPage, news: { ...fakeSources(news), collect: async () => ((newsCollected = true), news) } });
    const snapshot = await sources.collect({ type: "post-game", date: "2026-11-25" });

    expect(snapshot).toEqual({ date: "2026-11-25", documents: [], schedule: expect.any(Array) });
    expect(fetchPage.asked).toEqual([SCHEDULE_URL]);
    expect(newsCollected).toBe(false);
  });
});

describe("real sources: what the post-game snapshot reads from the content folder", () => {
  let contentDir: string;
  beforeEach(async () => {
    contentDir = await mkdtemp(path.join(tmpdir(), "gold-blooded-post-game-"));
  });
  afterEach(() => rm(contentDir, { recursive: true, force: true }));

  const preview: GamePreviewData = {
    title: "Minnesota in Mexico City",
    date: "2026-11-19",
    gameWeek: "2026-week-11",
    gameId: "2026_11_MIN_SF",
    season: 2026,
    week: 11,
    gameType: "REG",
    opponent: "MIN",
    venue: "neutral",
    kickoff: "2026-11-23T01:20:00.000Z",
    storylines: ["A neutral-site night game."],
    keys: ["Start fast."],
    prediction: { winner: "SF", score: { sf: 24, opponent: 17 } },
    sources: [{ url: "https://www.49ers.com/news/preview", outlet: "49ers.com" }],
  };
  const record: PredictionRecordData = {
    title: "2026 Prediction Record",
    season: 2026,
    updated: "2026-11-16",
    games: [
      {
        gameId: "2026_10_SF_DAL",
        gameWeek: "2026-week-10",
        week: 10,
        gameType: "REG",
        opponent: "DAL",
        venue: "away",
        result: { sf: 27, opponent: 24 },
        predicted: { winner: "DAL", score: { sf: 21, opponent: 24 } },
        correctWinner: false,
        pointsOff: 6,
      },
    ],
  };
  const collect = () => postGameSources({ contentDir, fetchPage: serving({ ...NFLVERSE, ...YOUTUBE }), news: fakeSources(news) }).collect(job);

  it("adds the game's Game Preview and the season's Prediction Record as they stand", async () => {
    await writeEntries(contentDir, [
      { type: "game-preview", path: "game-weeks/2026-week-11/preview.md", data: preview, body: "The 49ers head south." },
      { type: "prediction-record", path: "prediction-record/2026.md", data: record, body: "" },
    ]);
    const snapshot = await collect();

    expect(snapshot.gamePreview).toEqual(preview);
    expect(snapshot.current).toEqual({ "prediction-record": { data: record, body: "\n" } });
  });

  it("has neither when no Game Preview was published and no game has been scored", async () => {
    const snapshot = await collect();

    expect(snapshot.gamePreview).toBeUndefined();
    expect(snapshot.current).toEqual({});
  });

  it("fails the run when the Prediction Record doesn't match its schema, rather than overwrite it", async () => {
    await mkdir(path.join(contentDir, "prediction-record"), { recursive: true });
    await writeFile(path.join(contentDir, "prediction-record", "2026.md"), "---\ntitle: 2026 Prediction Record\nseason: 2026\n---\n");

    await expect(collect()).rejects.toThrow(/prediction-record\/2026.md doesn't match its schema/);
  });
});
