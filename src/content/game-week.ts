// Content that lives on a Game Week Page (GLOSSARY.md). Each Game Week has a folder,
// `content/game-weeks/<slug>/`, named by its slug (`2026-week-12`, `2025-wild-card`), with one
// Markdown file per part:
//
//   preview.md        the Game Preview (Thursday preview job, in a Game Week)
//   season-recap.md   the season recap (Thursday preview job, in a Bye Week)
//
// Later parts (the Stat Breakdown, Highlights) add their own files to the same folder.
// The site's content collections and the publish pipeline both validate against these schemas.
import { z } from "astro/zod";
import { GAME_TYPES } from "../pipeline/calendar";
import { injuryStatus, isoDate, quote } from "./news-summary";

export const GAME_WEEK_FILES = { "game-preview": "preview.md", "season-recap": "season-recap.md" } as const;

const gameWeekSlug = z.string().regex(/^\d{4}-[a-z0-9-]+$/, "expected a Game Week slug such as 2026-week-12");
const sources = z
  .array(z.object({ url: z.url({ protocol: /^https?$/ }), outlet: z.string().min(1) }))
  .min(1, "it must link to its sources");
const score = z.number().int().nonnegative();

/** Every quote must come from one of the piece's sources. */
function quotesFromSources(piece: { sources: { url: string }[]; quotes?: { source: string }[] }, ctx: z.RefinementCtx) {
  const linked = new Set(piece.sources.map((source) => source.url));
  piece.quotes?.forEach((q, i) => {
    if (!linked.has(q.source)) ctx.addIssue({ code: "custom", path: ["quotes", i, "source"], message: "a quote must come from one of the sources" });
  });
}

/**
 * The Game Preview: the narrative take on the upcoming game. The pipeline fills in the game
 * (from the schedule); the writer supplies the rest.
 */
export const gamePreviewSchema = z
  .object({
    title: z.string().min(1),
    /** When it was published. */
    date: isoDate,
    gameWeek: gameWeekSlug,
    gameId: z.string().min(1),
    season: z.number().int(),
    week: z.number().int(),
    gameType: z.enum(GAME_TYPES),
    opponent: z.string().min(1),
    venue: z.enum(["home", "away", "neutral"]),
    kickoff: z.iso.datetime(),
    storylines: z.array(z.string().min(1)).min(1, "a Game Preview needs storylines"),
    keys: z.array(z.string().min(1)).min(1, "a Game Preview needs keys to the game"),
    /** The predicted winner (a team abbreviation: SF or the opponent) and final score. */
    prediction: z.object({ winner: z.string().min(1), score: z.object({ sf: score, opponent: score }) }),
    sources,
    injuries: z.array(injuryStatus).optional(),
    quotes: z.array(quote).optional(),
  })
  .superRefine((preview, ctx) => {
    const { winner, score } = preview.prediction;
    if (winner !== "SF" && winner !== preview.opponent) {
      ctx.addIssue({ code: "custom", path: ["prediction", "winner"], message: `the winner must be SF or ${preview.opponent}` });
    } else if ((winner === "SF" ? score.sf - score.opponent : score.opponent - score.sf) <= 0) {
      ctx.addIssue({ code: "custom", path: ["prediction", "score"], message: "the predicted winner must have the higher score" });
    }
    quotesFromSources(preview, ctx);
  });

export type GamePreviewData = z.infer<typeof gamePreviewSchema>;

/**
 * The season recap a Bye Week carries instead of a Game Preview. The pipeline fills in the
 * record and the next game (from the schedule); the writer supplies the rest.
 */
export const seasonRecapSchema = z
  .object({
    title: z.string().min(1),
    date: isoDate,
    gameWeek: gameWeekSlug,
    season: z.number().int(),
    /** The NFL week the 49ers have off. */
    week: z.number().int(),
    record: z.object({ wins: score, losses: score, ties: score }),
    nextGame: z.object({ gameWeek: gameWeekSlug, opponent: z.string().min(1), venue: z.enum(["home", "away", "neutral"]), kickoff: z.iso.datetime() }),
    sources,
    injuries: z.array(injuryStatus).optional(),
    quotes: z.array(quote).optional(),
  })
  .superRefine(quotesFromSources);

export type SeasonRecapData = z.infer<typeof seasonRecapSchema>;
