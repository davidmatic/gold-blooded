// The nflverse schedule parser behind the real Thursday preview sources: games.csv in, the
// 49ers' games out. The fixture is a trimmed capture of nflverse's games.csv (2026-11-25):
// every 2026 Week 11 and 12 game, plus the 49ers' 2025 Wild Card and Divisional games.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseSchedule } from "../../src/pipeline/adapters/real/schedule";

const csv = readFileSync(new URL("../fixtures/sources/nflverse-games-excerpt.csv", import.meta.url), "utf8");

describe("nflverse schedule", () => {
  it("keeps only the 49ers' games, in kickoff order", () => {
    expect(parseSchedule(csv).map((game) => game.gameId)).toEqual([
      "2025_19_SF_PHI",
      "2025_20_SF_SEA",
      "2026_11_MIN_SF",
      "2026_12_SEA_SF",
    ]);
  });

  it("reads a finished game with its final score, from the 49ers' side", () => {
    expect(parseSchedule(csv)[1]).toEqual({
      gameId: "2025_20_SF_SEA",
      season: 2025,
      gameType: "DIV",
      week: 20,
      gameday: "2026-01-17",
      kickoff: "2026-01-18T01:00:00.000Z",
      opponent: "SEA",
      home: false,
      neutralSite: false,
      result: { sf: 6, opponent: 41 },
    });
  });

  it("reads an unplayed game with no result, and a neutral-site game", () => {
    const [, , mexicoCity, seattle] = parseSchedule(csv);

    expect(seattle).toEqual({
      gameId: "2026_12_SEA_SF",
      season: 2026,
      gameType: "REG",
      week: 12,
      gameday: "2026-11-29",
      kickoff: "2026-11-29T21:25:00.000Z",
      opponent: "SEA",
      home: true,
      neutralSite: false,
    });
    expect(mexicoCity).toMatchObject({ gameId: "2026_11_MIN_SF", neutralSite: true, kickoff: "2026-11-23T01:20:00.000Z" });
  });

  it("converts US Eastern kickoff times on either side of the daylight saving change", () => {
    const rows = [
      "game_id,season,game_type,week,gameday,weekday,gametime,away_team,away_score,home_team,home_score,location",
      "2026_08_SF_X,2026,REG,8,2026-10-25,Sunday,13:00,SF,,X,,Home",
      "2026_09_SF_Y,2026,REG,9,2026-11-08,Sunday,13:00,SF,,Y,,Home",
    ].join("\n");

    expect(parseSchedule(rows).map((game) => game.kickoff)).toEqual(["2026-10-25T17:00:00.000Z", "2026-11-08T18:00:00.000Z"]);
  });

  it("refuses a file that isn't the nflverse schedule", () => {
    expect(() => parseSchedule("<html>Not found</html>")).toThrow(/games\.csv/);
  });
});
