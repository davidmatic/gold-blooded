// The nflverse stat publish check, through the publish pipeline (Seam 1). The Thursday preview
// job's Stat Breakdown cites stats; the recorded snapshot carries trimmed 2026 nflverse
// player-week and team-week lines for the 49ers and Seattle (through Week 11).
import { describe, expect, it } from "vitest";
import { publish, type DraftEntry } from "../../src/pipeline";
import type { CitedStat } from "../../src/content/cited-stat";
import { fakeSources, recordedSnapshot } from "../support/fakes";

const snapshot = recordedSnapshot("thursday-preview-2026-11-26");
const BREAKDOWN_PATH = "game-weeks/2026-week-12/stat-breakdown.md";

const previewDraft: DraftEntry = {
  type: "game-preview",
  data: {
    title: "Seattle comes to Santa Clara",
    storylines: ["The NFC West lead is at stake."],
    keys: ["Win on early downs."],
    prediction: { winner: "SF", score: { sf: 27, opponent: 20 } },
    sources: [{ url: "https://www.49ers.com/news/injury-report-wednesday-week-13", outlet: "49ers.com" }],
  },
  body: "Seattle visits Levi's Stadium on Sunday.",
};

const season = { type: "season", season: 2026 } as const;

function citing(...stats: CitedStat[]) {
  const breakdown: DraftEntry = {
    type: "stat-breakdown",
    data: { title: "The matchup in numbers", stats, trends: ["The offense is rolling."] },
    body: "The numbers.",
  };
  return publish({
    job: "thursday-preview",
    date: "2026-11-26",
    sources: fakeSources(snapshot),
    writer: { write: async () => [previewDraft, breakdown] },
  });
}

describe("stat check: stats that match nflverse", () => {
  it("publishes season totals, per-game averages, last-N totals, single games, and derived rates", async () => {
    const result = await citing(
      { player: "Brock Purdy", team: "SF", stat: "passing_yards", scope: season, value: 2624, label: "Passing yards" },
      { player: "Brock Purdy", team: "SF", stat: "passing_tds", scope: { ...season, seasonType: "REG" }, value: 23, label: "Passing TDs" },
      { player: "Brock Purdy", team: "SF", stat: "completion_pct", scope: season, value: 71.0, label: "Completion %" },
      { player: "Christian McCaffrey", team: "SF", stat: "yards_per_carry", scope: season, value: 4.47, label: "Yards per carry" },
      { player: "Jaxon Smith-Njigba", team: "SEA", stat: "receiving_yards", scope: { type: "last-games", season: 2026, games: 3 }, value: 340, label: "Receiving yards" },
      { team: "SF", stat: "rushing_yards", scope: { type: "last-games", season: 2026, games: 3 }, per: "game", value: 164.7, label: "Rushing yards" },
      { team: "SEA", stat: "passing_yards", scope: { type: "game", gameId: "2026_05_SF_SEA" }, value: 195, label: "Passing yards" },
      { player: "Brock Purdy", team: "SF", stat: "passing_cpoe", scope: { type: "game", gameId: "2026_02_MIA_SF" }, value: 29.04, label: "CPOE" },
    );

    expect(result.status).toBe("published");
  });

  it("matches a value to the precision it is stated at, and no further", async () => {
    // Purdy's season completion rate is 71.034...%: 71 and 71.03 match, 71.1 does not.
    const pct = (value: number): CitedStat => ({ player: "Brock Purdy", team: "SF", stat: "completion_pct", scope: season, value, label: "Completion %" });

    expect((await citing(pct(71), pct(71.03))).status).toBe("published");
    expect(await citing(pct(71.1))).toEqual({
      status: "rejected",
      failures: [{ check: "nflverse-stats", entry: BREAKDOWN_PATH, reason: "Brock Purdy (SF) completion_pct, 2026 season: draft says 71.1, nflverse says 71.03" }],
    });
  });
});

describe("stat check: stats that don't match nflverse", () => {
  it("rejects a stat whose value differs from nflverse", async () => {
    const result = await citing({ player: "Brock Purdy", team: "SF", stat: "passing_yards", scope: season, value: 2700, label: "Passing yards" });

    expect(result).toEqual({
      status: "rejected",
      failures: [{ check: "nflverse-stats", entry: BREAKDOWN_PATH, reason: "Brock Purdy (SF) passing_yards, 2026 season: draft says 2700, nflverse says 2624" }],
    });
  });

  it("rejects a per-game average or last-N total worked out wrong", async () => {
    const result = await citing(
      { team: "SF", stat: "rushing_yards", scope: { type: "last-games", season: 2026, games: 3 }, per: "game", value: 170, label: "Rushing yards" },
      { player: "Jaxon Smith-Njigba", team: "SEA", stat: "receiving_yards", scope: { type: "last-games", season: 2026, games: 3 }, value: 350, label: "Receiving yards" },
    );

    expect(result).toEqual({
      status: "rejected",
      failures: [
        { check: "nflverse-stats", entry: BREAKDOWN_PATH, reason: "SF rushing_yards per game, last 3 games of 2026: draft says 170, nflverse says 164.67" },
        { check: "nflverse-stats", entry: BREAKDOWN_PATH, reason: "Jaxon Smith-Njigba (SEA) receiving_yards, last 3 games of 2026: draft says 350, nflverse says 340" },
      ],
    });
  });

  it("rejects a stat nflverse doesn't have: an unknown player, a game he didn't play, an unknown column", async () => {
    const result = await citing(
      { player: "Brock Purdie", team: "SF", stat: "passing_yards", scope: season, value: 2624, label: "Passing yards" },
      { player: "Brock Purdy", team: "SF", stat: "passing_yards", scope: { type: "game", gameId: "2026_08_CHI_SEA" }, value: 0, label: "Passing yards" },
      { team: "SF", stat: "passing_yardz", scope: season, value: 2624, label: "Passing yards" },
    );

    expect(result).toEqual({
      status: "rejected",
      failures: [
        { check: "nflverse-stats", entry: BREAKDOWN_PATH, reason: "Brock Purdie (SF) passing_yards, 2026 season: nflverse has no line for Brock Purdie (SF) in the 2026 season" },
        { check: "nflverse-stats", entry: BREAKDOWN_PATH, reason: "Brock Purdy (SF) passing_yards, game 2026_08_CHI_SEA: nflverse has no line for Brock Purdy (SF) in game 2026_08_CHI_SEA" },
        { check: "nflverse-stats", entry: BREAKDOWN_PATH, reason: "SF passing_yardz, 2026 season: nflverse has no stat passing_yardz" },
      ],
    });
  });

  it("rejects a rate totalled or averaged over several games", async () => {
    const result = await citing({ player: "Brock Purdy", team: "SF", stat: "passing_cpoe", scope: season, per: "game", value: 7.5, label: "CPOE" });

    expect(result).toEqual({
      status: "rejected",
      failures: [
        { check: "nflverse-stats", entry: BREAKDOWN_PATH, reason: "Brock Purdy (SF) passing_cpoe per game, 2026 season: passing_cpoe is a rate, so cite it for one game" },
      ],
    });
  });

  it("rejects every cited stat when the snapshot has no nflverse stats", async () => {
    const { stats: _, ...withoutStats } = snapshot;
    const result = await publish({
      job: "thursday-preview",
      date: "2026-11-26",
      sources: fakeSources(withoutStats),
      writer: {
        write: async () => [
          previewDraft,
          {
            type: "stat-breakdown",
            data: { title: "Numbers", stats: [{ team: "SF", stat: "passing_yards", scope: season, value: 2624, label: "Passing yards" }], trends: ["Up."] },
            body: "",
          },
        ],
      },
    });

    expect(result).toEqual({
      status: "rejected",
      failures: [{ check: "nflverse-stats", entry: BREAKDOWN_PATH, reason: "the source snapshot has no nflverse stats" }],
    });
  });
});
