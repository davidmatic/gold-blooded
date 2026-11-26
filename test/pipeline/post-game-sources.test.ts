// The real post-game sources, driven through their SourceAdapter interface with a fake page
// fetcher and a fake news collector. No network.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
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
