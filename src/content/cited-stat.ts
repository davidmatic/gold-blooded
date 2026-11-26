// A cited stat: one number a piece of content states, in a structured form the nflverse stat
// publish check can look up. Any content type that shows stats (the Stat Breakdown, Highlights,
// Season Stats) lists every number it states in a `stats` array of these, the way a News Summary
// lists its quotes and injury statuses.
//
//   { player: "Brock Purdy", team: "SF", stat: "passing_yards", scope: { type: "season", season: 2026 }, value: 2624 }
//
// - player: the player's name as nflverse displays it ("Brock Purdy"). Leave it out for a team stat.
// - team: the nflverse team abbreviation (SF, SEA, LA). For a player, the team he played for.
// - stat: an nflverse stats column (`passing_yards`, `rushing_tds`, `def_sacks`), or one of the
//   derived rates in DERIVED_STATS (`completion_pct`, `yards_per_carry`, ...).
// - scope: one game (by nflverse game id), a season (optionally just its regular season or
//   postseason), the last N games of a season that the player or team played, or a run of
//   seasons (`{ type: "seasons", from: 2022, to: 2026 }`, a career).
// - per: "game" for a per-game average over the scope instead of a total.
// - value: the number as the piece states it. It matches when nflverse's value, rounded to as
//   many decimal places as `value` has, is the same number.
// - label: how the site shows the stat ("Passing yards").
import { z } from "astro/zod";

/** Rates the stat check works out from nflverse's counting columns over the cited scope. */
export const DERIVED_STATS = ["completion_pct", "yards_per_attempt", "yards_per_carry", "yards_per_reception"] as const;

export const SEASON_TYPES = ["REG", "POST"] as const;

export const statScope = z.discriminatedUnion("type", [
  z.object({ type: z.literal("game"), gameId: z.string().regex(/^\d{4}_\d{2}_[A-Z]+_[A-Z]+$/, "expected an nflverse game id such as 2026_12_SEA_SF") }),
  z.object({ type: z.literal("season"), season: z.number().int(), seasonType: z.enum(SEASON_TYPES).optional() }),
  z.object({ type: z.literal("last-games"), season: z.number().int(), games: z.number().int().min(1) }),
  // Several seasons together, regular season and postseason: a career, such as Purdy's since 2022.
  z.object({ type: z.literal("seasons"), from: z.number().int(), to: z.number().int() }),
]);

export type StatScope = z.infer<typeof statScope>;

export const citedStat = z.object({
  player: z.string().min(1).optional(),
  team: z.string().regex(/^[A-Z]{2,3}$/, "expected an nflverse team abbreviation such as SF"),
  stat: z.string().regex(/^[a-z0-9_]+$/, "expected an nflverse stat column such as passing_yards"),
  scope: statScope,
  per: z.literal("game").optional(),
  value: z.number(),
  label: z.string().min(1),
});

export type CitedStat = z.infer<typeof citedStat>;
