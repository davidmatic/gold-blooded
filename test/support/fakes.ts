// Fake adapters for Seam 1 (the publish pipeline). Nothing here touches the network.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ContentWriter, DraftEntry, SourceAdapter, SourceSnapshot } from "../../src/pipeline";

const snapshotsRoot = fileURLToPath(new URL("../fixtures/snapshots", import.meta.url));

/** A recorded source snapshot from `test/fixtures/snapshots/<name>.json`. */
export function recordedSnapshot(name: string): SourceSnapshot {
  return JSON.parse(readFileSync(path.join(snapshotsRoot, `${name}.json`), "utf8"));
}

/**
 * Serves a recorded snapshot. Every link resolves unless it is listed in `deadLinks`.
 */
export function fakeSources(snapshot: SourceSnapshot, options: { deadLinks?: string[] } = {}): SourceAdapter {
  const dead = new Set(options.deadLinks ?? []);
  return {
    collect: async () => snapshot,
    linkResolves: async (url) => !dead.has(url),
  };
}

/**
 * A Stat Breakdown about the 49ers alone, which passes the stat check against the recorded
 * `thursday-preview-2026-11-26` snapshot's nflverse lines whichever Game Week it is written for.
 * The Thursday preview job writes one beside every Game Preview.
 */
export const sfStatBreakdown: DraftEntry = {
  type: "stat-breakdown",
  data: {
    title: "The 49ers in numbers",
    stats: [{ player: "Brock Purdy", team: "SF", stat: "passing_yards", scope: { type: "season", season: 2026 }, value: 2624, label: "Passing yards" }],
    trends: ["Purdy is on pace for a career year."],
  },
  body: "The numbers.",
};

/**
 * The Purdy Shrine's share of a post-game run: a Love Letter that cites no stats and a new
 * Reason We Love Brock. They pass every check the day after any game.
 */
export const purdyShrineDrafts: DraftEntry[] = [
  { type: "love-letter", data: { title: "Dear Brock" }, body: "Another week of loving you." },
  { type: "reasons-we-love-brock", data: { reason: "He makes the hard throws look easy." }, body: "" },
];

/**
 * Purdy's earlier seasons, cut down: one 49ers game each for 2022 to 2024 (added to the schedule),
 * and his lines from those and from the 2025 opener (the recorded schedule's 2025 season has 19
 * games, so the rest of it is DNP).
 */
export const PURDY_EARLIER_GAMES = [
  { gameId: "2022_14_TB_SF", season: 2022, week: 14, gameday: "2022-12-11", opponent: "TB", yards: 185, tds: 2 },
  { gameId: "2023_01_SF_PIT", season: 2023, week: 1, gameday: "2023-09-10", opponent: "PIT", yards: 220, tds: 2 },
  { gameId: "2024_01_NYJ_SF", season: 2024, week: 1, gameday: "2024-09-09", opponent: "NYJ", yards: 231, tds: 0 },
  { gameId: "2025_01_SF_SEA", season: 2025, week: 1, gameday: "2025-09-07", opponent: "SEA", yards: 277, tds: 2 },
] as const;

/** A snapshot with Purdy's career lines since 2022, as the real post-game sources collect them. */
export function withPurdyCareer(source: SourceSnapshot): SourceSnapshot {
  const lines = PURDY_EARLIER_GAMES.map((game) => ({
    playerId: "00-0037834",
    player: "Brock Purdy",
    position: "QB",
    season: game.season,
    week: game.week,
    seasonType: "REG" as const,
    gameId: game.gameId,
    team: "SF",
    opponent: game.opponent,
    stats: { completions: 20, attempts: 30, passing_yards: game.yards, passing_tds: game.tds, passing_interceptions: 1, rushing_yards: 10, rushing_tds: 0 },
  }));
  const games = PURDY_EARLIER_GAMES.filter((game) => game.season < 2025).map((game) => ({
    gameId: game.gameId,
    season: game.season,
    gameType: "REG" as const,
    week: game.week,
    gameday: game.gameday,
    kickoff: `${game.gameday}T20:25:00.000Z`,
    opponent: game.opponent,
    home: game.gameId.endsWith("_SF"),
    neutralSite: false,
    result: { sf: 30, opponent: 20 },
  }));
  return { ...source, schedule: [...games, ...source.schedule!], stats: { ...source.stats!, players: [...lines, ...source.stats!.players] }, purdyCareer: true };
}

/** Returns canned drafts, whatever the job and snapshot. */
export function fakeWriter(drafts: DraftEntry[]): ContentWriter {
  return { write: async () => drafts };
}
