// Season Stats (GLOSSARY.md): the 49ers' team and player numbers for the whole season up to the
// latest game. One standing document per season, `content/season-stats/<season>.md`, rewritten
// by the post-game job the day after every game. Every number it shows is a cited stat in
// `stats`, for the 49ers over this season, which the stat publish check compares with nflverse.
// The pipeline fills in the season, the record, and the game it runs through; the writer
// supplies the stats and the write-up.
import { z } from "astro/zod";
import { citedStat } from "./cited-stat";
import { isoDate } from "./news-summary";

const score = z.number().int().nonnegative();

export const seasonStatsSchema = z
  .object({
    title: z.string().min(1),
    season: z.number().int(),
    /** When the post-game job last rewrote it. */
    updated: isoDate,
    /** The latest game the numbers include. */
    throughGame: z.object({
      gameId: z.string().min(1),
      gameWeek: z.string().min(1),
      opponent: z.string().min(1),
      venue: z.enum(["home", "away", "neutral"]),
      result: z.object({ sf: score, opponent: score }),
    }),
    record: z.object({ wins: score, losses: score, ties: score }),
    stats: z.array(citedStat).min(1, "Season Stats need stats"),
  })
  .superRefine((page, ctx) => {
    page.stats.forEach((stat, i) => {
      if (stat.team !== "SF") ctx.addIssue({ code: "custom", path: ["stats", i, "team"], message: "a Season Stats stat must be about SF" });
      if (stat.scope.type !== "season" || stat.scope.season !== page.season) {
        ctx.addIssue({ code: "custom", path: ["stats", i, "scope"], message: `a Season Stats stat must be for the ${page.season} season` });
      }
    });
  });

export type SeasonStatsData = z.infer<typeof seasonStatsSchema>;

/** Where a season's Season Stats live in the content folder. */
export function seasonStatsPath(season: number): string {
  return `season-stats/${season}.md`;
}
