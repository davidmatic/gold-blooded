// The post-game job through the publish pipeline (Seam 1). The recorded snapshot carries the
// 49ers' real 2025 and 2026 nflverse schedule and their 2026 nflverse lines through Week 11
// (35-10 over Minnesota in Mexico City, Sunday night, 2026-11-22), plus the official YouTube
// clips the post-game sources add.
import { describe, expect, it } from "vitest";
import { publish, type ContentWriter, type DraftEntry, type Job, type SourceSnapshot } from "../../src/pipeline";
import { fakeSources, purdyShrineDrafts, recordedSnapshot } from "../support/fakes";

const snapshot: SourceSnapshot = {
  ...recordedSnapshot("thursday-preview-2026-11-26"),
  videos: [
    {
      videoId: "Id7LlG3tijo",
      title: "Mic’d Up: Warner and Kittle Take Over Mexico City | 49ers",
      channel: "San Francisco 49ers",
      url: "https://www.youtube.com/watch?v=Id7LlG3tijo",
      publishedAt: "2026-11-23T01:00:06+00:00",
      description: "Listen in as Fred Warner and George Kittle were wired for sound.",
    },
  ],
};

const GAME = "2026_11_MIN_SF";

const highlightsDraft: DraftEntry = {
  type: "highlights",
  data: {
    title: "Purdy and Kittle carve up Minnesota",
    standouts: [
      { player: "Brock Purdy", team: "SF", writeUp: "Three touchdowns and 255 yards." },
      { player: "George Kittle", team: "SF", writeUp: "Two scores, both in the red zone." },
    ],
    stats: [
      { player: "Brock Purdy", team: "SF", stat: "passing_yards", scope: { type: "game", gameId: GAME }, value: 255, label: "Passing yards" },
      { player: "Brock Purdy", team: "SF", stat: "passing_tds", scope: { type: "game", gameId: GAME }, value: 3, label: "Passing TDs" },
      { player: "George Kittle", team: "SF", stat: "receiving_tds", scope: { type: "game", gameId: GAME }, value: 2, label: "Receiving TDs" },
    ],
    clips: [{ videoId: "Id7LlG3tijo", title: "Mic’d Up: Warner and Kittle Take Over Mexico City", channel: "San Francisco 49ers" }],
  },
  body: "A clinical night in Mexico City.",
};

const seasonStatsDraft: DraftEntry = {
  type: "season-stats",
  data: {
    stats: [
      { player: "Brock Purdy", team: "SF", stat: "passing_yards", scope: { type: "season", season: 2026 }, value: 2624, label: "Passing yards" },
      { team: "SF", stat: "rushing_yards", scope: { type: "season", season: 2026 }, value: 1386, label: "Rushing yards" },
    ],
  },
  body: "Nine wins in ten, and the offense keeps humming.",
};

/**
 * A writer that returns the drafts of the types the job asks for (with the Purdy Shrine's, which
 * test/pipeline/purdy-shrine.test.ts covers), and remembers the job. Given no drafts, it writes none.
 */
function recordingWriter(drafts: DraftEntry[] = [highlightsDraft, seasonStatsDraft]): ContentWriter & { jobs: Job[] } {
  const jobs: Job[] = [];
  return {
    jobs,
    write: async (job) => {
      jobs.push(job);
      return [...drafts, ...(drafts.length > 0 ? purdyShrineDrafts : [])].filter((draft) => job.contentTypes?.includes(draft.type));
    },
  };
}

function runPostGame(date: string, writer: ContentWriter = recordingWriter(), source: SourceSnapshot = snapshot) {
  return publish({ job: "post-game", date, sources: fakeSources(source), writer });
}

describe("post-game job: the day after a game", () => {
  it("writes Highlights onto the Game Week Page of the game just played, and updates Season Stats", async () => {
    const result = await runPostGame("2026-11-23");
    if (result.status === "published") result.entries = result.entries.filter((entry) => entry.type === "highlights" || entry.type === "season-stats");

    expect(result).toEqual({
      status: "published",
      entries: [
        {
          type: "highlights",
          path: "game-weeks/2026-week-11/highlights.md",
          data: {
            ...highlightsDraft.data,
            date: "2026-11-23",
            gameWeek: "2026-week-11",
            gameId: GAME,
            season: 2026,
            week: 11,
            gameType: "REG",
            opponent: "MIN",
            venue: "neutral",
            kickoff: "2026-11-23T01:20:00.000Z",
            result: { sf: 35, opponent: 10 },
          },
          body: highlightsDraft.body,
        },
        {
          type: "season-stats",
          path: "season-stats/2026.md",
          data: {
            ...seasonStatsDraft.data,
            title: "2026 Season Stats",
            season: 2026,
            updated: "2026-11-23",
            throughGame: { gameId: GAME, gameWeek: "2026-week-11", week: 11, gameType: "REG", opponent: "MIN", venue: "neutral", result: { sf: 35, opponent: 10 } },
            record: { wins: 9, losses: 1, ties: 0 },
          },
          body: seasonStatsDraft.body,
        },
      ],
    });
  });

  it("runs after a Monday night game, on Tuesday", async () => {
    const writer = recordingWriter([]);
    await runPostGame("2026-10-20", writer);

    expect(writer.jobs[0]?.contentTypes).toEqual(["highlights", "season-stats", "love-letter", "reasons-we-love-brock"]);
    expect(writer.jobs[0]?.calendar?.previous?.gameId).toBe("2026_06_WAS_SF");
  });

  it("runs after a Thursday night game, on Friday", async () => {
    const played = { ...snapshot, schedule: snapshot.schedule!.map((game) => (game.gameId === "2026_15_SF_LAC" ? { ...game, result: { sf: 24, opponent: 21 } } : game)) };
    const writer = recordingWriter([]);
    await runPostGame("2026-12-18", writer, played);

    expect(writer.jobs[0]?.contentTypes).toEqual(["highlights", "season-stats", "love-letter", "reasons-we-love-brock"]);
    expect(writer.jobs[0]?.calendar?.previous?.gameId).toBe("2026_15_SF_LAC");
  });

  it("runs after the season's last game, though the date is already the Offseason", async () => {
    // The 2025 Divisional Round loss at Seattle, Saturday 2026-01-17.
    const writer = recordingWriter([]);
    await runPostGame("2026-01-18", writer);

    expect(writer.jobs[0]?.calendar?.period).toBe("offseason");
    expect(writer.jobs[0]?.calendar?.previous?.gameId).toBe("2025_20_SF_SEA");
    expect(writer.jobs[0]?.contentTypes).toEqual(["highlights", "season-stats", "love-letter", "reasons-we-love-brock"]);
  });

  it("fails the run, before asking the writer, when the schedule has no final score for the game yet", async () => {
    const unscored = { ...snapshot, schedule: snapshot.schedule!.map((game) => (game.gameId === GAME ? { ...game, result: undefined } : game)) };
    const writer = recordingWriter();

    await expect(runPostGame("2026-11-23", writer, unscored)).rejects.toThrow(/no final score for 2026_11_MIN_SF/);
    expect(writer.jobs).toEqual([]);
  });
});

describe("post-game job: no game in the previous day", () => {
  it.each([
    ["two days after a game", "2026-11-24"],
    ["on game day itself", "2026-11-22"],
    ["in a Bye Week", "2026-10-29"],
    ["in the Offseason", "2026-07-01"],
  ])("writes nothing %s, and never asks the writer", async (_, date) => {
    const writer = recordingWriter();
    const result = await runPostGame(date, writer);

    expect(result).toEqual({ status: "published", entries: [] });
    expect(writer.jobs).toEqual([]);
  });
});

describe("post-game job: publish checks", () => {
  const withHighlights = (data: Record<string, unknown>) => recordingWriter([{ ...highlightsDraft, data: { ...highlightsDraft.data, ...data } }, seasonStatsDraft]);

  it("rejects a Highlights stat that doesn't match nflverse", async () => {
    const stats = [{ player: "Brock Purdy", team: "SF", stat: "passing_yards", scope: { type: "game", gameId: GAME }, value: 300, label: "Passing yards" }];
    const result = await runPostGame("2026-11-23", withHighlights({ stats, standouts: [{ player: "Brock Purdy", team: "SF", writeUp: "Big night." }] }));

    expect(result).toEqual({
      status: "rejected",
      failures: [
        {
          check: "nflverse-stats",
          entry: "game-weeks/2026-week-11/highlights.md",
          reason: "Brock Purdy (SF) passing_yards, game 2026_11_MIN_SF: draft says 300, nflverse says 255",
        },
      ],
    });
  });

  it("rejects a Season Stats stat that doesn't match nflverse", async () => {
    const wrong = { ...seasonStatsDraft, data: { stats: [{ team: "SF", stat: "rushing_yards", scope: { type: "season", season: 2026 }, value: 1400, label: "Rushing yards" }] } };
    const result = await runPostGame("2026-11-23", recordingWriter([highlightsDraft, wrong]));

    expect(result.status).toBe("rejected");
    expect(result.status === "rejected" && result.failures).toEqual([
      { check: "nflverse-stats", entry: "season-stats/2026.md", reason: "SF rushing_yards, 2026 season: draft says 1400, nflverse says 1386" },
    ]);
  });

  it("rejects an embedded clip that isn't in the snapshot's official YouTube videos", async () => {
    const clips = [{ videoId: "dQw4w9WgXcQ", title: "Not an official clip", channel: "San Francisco 49ers" }];
    const result = await runPostGame("2026-11-23", withHighlights({ clips }));

    expect(result).toEqual({
      status: "rejected",
      failures: [
        {
          check: "official-clips",
          entry: "game-weeks/2026-week-11/highlights.md",
          reason: "clip dQw4w9WgXcQ is not one of the official 49ers or NFL YouTube videos in the source snapshot",
        },
      ],
    });
  });

  it("publishes Highlights with no clips when there are none", async () => {
    const { clips: _, ...noClips } = highlightsDraft.data;
    const result = await runPostGame("2026-11-23", recordingWriter([{ ...highlightsDraft, data: noClips }, seasonStatsDraft]));

    expect(result.status).toBe("published");
  });

  it("rejects Highlights stats from another game, and a standout with no stat line", async () => {
    const stats = [{ player: "Brock Purdy", team: "SF", stat: "passing_yards", scope: { type: "game", gameId: "2026_10_SF_DAL" }, value: 1, label: "Passing yards" }];
    const result = await runPostGame("2026-11-23", withHighlights({ stats }));

    expect(result.status).toBe("rejected");
    const reasons = result.status === "rejected" ? result.failures.filter((f) => f.check === "schema").map((f) => f.reason) : [];
    expect(reasons.join("; ")).toContain("stats.0.scope: a Highlights stat must be from game 2026_11_MIN_SF");
    expect(reasons.join("; ")).toContain("standouts.1: George Kittle needs a stat line in stats");
  });

  it("rejects Season Stats that aren't the 49ers' numbers for this season", async () => {
    const wrong = {
      ...seasonStatsDraft,
      data: { stats: [{ team: "SF", stat: "rushing_yards", scope: { type: "game", gameId: GAME }, value: 90, label: "Rushing yards" }] },
    };
    const result = await runPostGame("2026-11-23", recordingWriter([highlightsDraft, wrong]));

    expect(result.status === "rejected" && result.failures.map((f) => f.reason).join("; ")).toContain(
      "stats.0.scope: a Season Stats stat must be for the 2026 season",
    );
  });

  it("rejects a run that leaves out the Highlights", async () => {
    const result = await runPostGame("2026-11-23", recordingWriter([seasonStatsDraft]));

    expect(result).toEqual({
      status: "rejected",
      failures: [{ check: "schema", entry: "highlights", reason: "the post-game job writes exactly one highlights, and the writer returned 0" }],
    });
  });
});
