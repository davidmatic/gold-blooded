// The Prediction Record through the publish pipeline (Seam 1). The day after a game, the
// post-game job scores the game's Game Preview prediction (from the content store, carried in the
// source snapshot) against the final score on the schedule. No writer is involved in the scoring.
// The recorded schedule has the 49ers beating Minnesota 35-10 in Week 11 (2026-11-22).
import { describe, expect, it } from "vitest";
import type { GamePreviewData } from "../../src/content/game-week";
import { publish, type ContentWriter, type DraftEntry, type SourceSnapshot } from "../../src/pipeline";
import { fakeSources, recordedSnapshot } from "../support/fakes";

const GAME = "2026_11_MIN_SF";
const base = recordedSnapshot("thursday-preview-2026-11-26");

const drafts: DraftEntry[] = [
  {
    type: "highlights",
    data: {
      title: "Purdy carves up Minnesota",
      standouts: [{ player: "Brock Purdy", team: "SF", writeUp: "Three touchdowns." }],
      stats: [{ player: "Brock Purdy", team: "SF", stat: "passing_tds", scope: { type: "game", gameId: GAME }, value: 3, label: "Passing TDs" }],
    },
    body: "A clinical night.",
  },
  {
    type: "season-stats",
    data: { stats: [{ team: "SF", stat: "rushing_yards", scope: { type: "season", season: 2026 }, value: 1386, label: "Rushing yards" }] },
    body: "Nine wins in ten.",
  },
];
const writer: ContentWriter = { write: async (job) => drafts.filter((draft) => job.contentTypes?.includes(draft.type)) };

function preview(prediction: GamePreviewData["prediction"]): GamePreviewData {
  return {
    title: "Minnesota in Mexico City",
    date: "2026-11-19",
    gameWeek: "2026-week-11",
    gameId: GAME,
    season: 2026,
    week: 11,
    gameType: "REG",
    opponent: "MIN",
    venue: "neutral",
    kickoff: "2026-11-23T01:20:00.000Z",
    storylines: ["A neutral-site night game."],
    keys: ["Start fast."],
    prediction,
    sources: [{ url: "https://www.49ers.com/news/preview", outlet: "49ers.com" }],
  };
}

const WEEK_11 = { gameId: GAME, gameWeek: "2026-week-11", week: 11, gameType: "REG", opponent: "MIN", venue: "neutral", result: { sf: 35, opponent: 10 } };

async function recordAfter(snapshot: SourceSnapshot) {
  const result = await publish({ job: "post-game", date: "2026-11-23", sources: fakeSources(snapshot), writer });
  if (result.status !== "published") throw new Error(JSON.stringify(result.failures));
  return result.entries.find((entry) => entry.type === "prediction-record");
}

describe("post-game job: the Prediction Record", () => {
  it("scores a correct pick: the right winner, and how many points the predicted score was off by", async () => {
    const record = await recordAfter({ ...base, gamePreview: preview({ winner: "SF", score: { sf: 24, opponent: 17 } }) });

    expect(record).toEqual({
      type: "prediction-record",
      path: "prediction-record/2026.md",
      data: {
        title: "2026 Prediction Record",
        season: 2026,
        updated: "2026-11-23",
        games: [{ ...WEEK_11, predicted: { winner: "SF", score: { sf: 24, opponent: 17 } }, correctWinner: true, pointsOff: 18 }],
      },
      body: "",
    });
  });

  it("scores a wrong pick", async () => {
    const record = await recordAfter({ ...base, gamePreview: preview({ winner: "MIN", score: { sf: 20, opponent: 23 } }) });

    expect(record?.data.games).toEqual([{ ...WEEK_11, predicted: { winner: "MIN", score: { sf: 20, opponent: 23 } }, correctWinner: false, pointsOff: 28 }]);
  });

  it("skips a game with no Game Preview: the record isn't written, so nothing counts as a miss", async () => {
    expect(await recordAfter(base)).toBeUndefined();
  });

  it("skips a Game Preview that is about another game", async () => {
    expect(await recordAfter({ ...base, gamePreview: { ...preview({ winner: "SF", score: { sf: 24, opponent: 17 } }), gameId: "2026_10_SF_DAL" } })).toBeUndefined();
  });

  it("adds the game to the season's record as it stood", async () => {
    const week10 = { gameId: "2026_10_SF_DAL", gameWeek: "2026-week-10", week: 10, gameType: "REG", opponent: "DAL", venue: "away", result: { sf: 27, opponent: 24 }, predicted: { winner: "DAL", score: { sf: 21, opponent: 24 } }, correctWinner: false, pointsOff: 6 };
    const current = { title: "2026 Prediction Record", season: 2026, updated: "2026-11-16", games: [week10] } as const;
    const record = await recordAfter({
      ...base,
      gamePreview: preview({ winner: "SF", score: { sf: 24, opponent: 17 } }),
      current: { "prediction-record": { data: current as never, body: "" } },
    });

    expect(record?.data.games.map((game) => [game.gameId, game.correctWinner, game.pointsOff])).toEqual([
      ["2026_10_SF_DAL", false, 6],
      [GAME, true, 18],
    ]);
  });

  it("re-running for the same game re-scores it rather than counting it twice", async () => {
    const first = await recordAfter({ ...base, gamePreview: preview({ winner: "SF", score: { sf: 24, opponent: 17 } }) });
    const again = await recordAfter({
      ...base,
      gamePreview: preview({ winner: "SF", score: { sf: 31, opponent: 10 } }),
      current: { "prediction-record": { data: first!.data, body: "" } },
    });

    expect(again?.data.games).toEqual([{ ...WEEK_11, predicted: { winner: "SF", score: { sf: 31, opponent: 10 } }, correctWinner: true, pointsOff: 4 }]);
  });

  it("never asks the writer for the Prediction Record", async () => {
    const asked: string[][] = [];
    const recording: ContentWriter = { write: async (job, snapshot) => (asked.push(job.contentTypes ?? []), writer.write(job, snapshot)) };
    await publish({ job: "post-game", date: "2026-11-23", sources: fakeSources({ ...base, gamePreview: preview({ winner: "SF", score: { sf: 24, opponent: 17 } }) }), writer: recording });

    expect(asked).toEqual([["highlights", "season-stats"]]);
  });
});
