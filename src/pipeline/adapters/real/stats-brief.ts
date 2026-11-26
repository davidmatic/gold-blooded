// What the writers that cite stats share: the structured-output shape of a cited stat, and the
// games and nflverse numbers as their briefs show them.
import { z } from "zod";
import { SEASON_TYPES } from "../../../content/cited-stat";
import { formatKickoff, gameWeekName, matchup } from "../../../site/game-weeks";
import { venue, type ScheduledGame } from "../../calendar";
import { statValue, type NflverseStats, type StatRef } from "../../stats";

// Structured output takes no unions, so a cited stat's scope comes back flat, with nulls for
// the fields its type doesn't use, and toCitedStat() turns it into the cited-stat shape.
export const statOutput = z.object({
  player: z.string().nullable(),
  team: z.string(),
  stat: z.string(),
  scope: z.object({
    type: z.enum(["game", "season", "last-games"]),
    gameId: z.string().nullable(),
    season: z.number().int().nullable(),
    seasonType: z.enum(SEASON_TYPES).nullable(),
    games: z.number().int().nullable(),
  }),
  perGame: z.boolean(),
  value: z.number(),
  label: z.string(),
});
export type StatOutput = z.infer<typeof statOutput>;

/** A cited stat as Claude returns it, in the cited-stat shape: nulls dropped. */
export function toCitedStat({ player, team, stat, scope, perGame, value, label }: StatOutput): Record<string, unknown> {
  return {
    ...(player !== null && { player }),
    team,
    stat,
    scope:
      scope.type === "game"
        ? { type: "game", gameId: scope.gameId }
        : scope.type === "last-games"
          ? { type: "last-games", season: scope.season, games: scope.games }
          : { type: "season", season: scope.season, ...(scope.seasonType && { seasonType: scope.seasonType }) },
    ...(perGame && { per: "game" }),
    value,
    label,
  };
}

/** nflverse columns the briefs show, in this order. */
export const BRIEF_COLUMNS = [
  "completions",
  "attempts",
  "passing_yards",
  "passing_tds",
  "passing_interceptions",
  "sacks_suffered",
  "carries",
  "rushing_yards",
  "rushing_tds",
  "receptions",
  "targets",
  "receiving_yards",
  "receiving_tds",
  "def_tackles_solo",
  "def_sacks",
  "def_interceptions",
];

/** A player makes a season brief with this much volume over the season in any one column. */
export const NOTABLE: Record<string, number> = { attempts: 10, carries: 10, targets: 10, def_tackles_solo: 10, def_sacks: 1, def_interceptions: 1 };

/** The stat as the stat check counts it, or 0 when nflverse has none. */
export function lookup(stats: NflverseStats, ref: StatRef): number {
  const found = statValue(stats, ref);
  return "value" in found ? found.value : 0;
}

/** "completions 25, attempts 34, ...", leaving out zeros when asked. */
export function columns(names: string[], value: (column: string) => number, skipZeros = false): string {
  return names
    .map((name) => [name, Math.round(value(name) * 100) / 100] as const)
    .filter(([, v]) => !skipZeros || v !== 0)
    .map(([name, v]) => `${name} ${v}`)
    .join(", ");
}

/** "2026 Week 11, vs MIN (neutral site), won 35-10" or "2026 Week 12, vs SEA, kickoff ... (id)". */
export function describeGame(game: ScheduledGame): string {
  const name = `${gameWeekName(game)}, ${matchup({ opponent: game.opponent, venue: venue(game) })}`;
  if (!game.result) return `${name}, kickoff ${formatKickoff(game.kickoff)} (${game.gameId})`;
  const { sf, opponent } = game.result;
  return `${name}, ${sf > opponent ? "won" : sf < opponent ? "lost" : "tied"} ${sf}-${opponent}`;
}
