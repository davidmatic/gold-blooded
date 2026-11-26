// The Purdy Shrine (GLOSSARY.md): everything we adore about Brock Purdy, family-friendly and
// never about his personal life or family. Its content lives under `content/purdy-shrine/`:
//
//   love-letters/<gameWeek>.md  a Love Letter, one per game (post-game job)
//   reasons.md                  the Reasons We Love Brock running list (post-game job adds one per game)
//   stat-tracker.md             his season and career numbers, with DNP games (post-game job, from nflverse)
//   origin-story.md             "Mr. Irrelevant to Mr. Everything" (written by hand)
//
// The site's content collections and the publish pipeline both validate against these schemas.
import { z } from "astro/zod";
import { GAME_TYPES } from "../pipeline/calendar";
import { citedStat } from "./cited-stat";
import { injuryStatus, isoDate, quote } from "./news-summary";

/** Brock Purdy as nflverse knows him, and his first season (the 2022 draft's last pick). */
export const PURDY = { player: "Brock Purdy", playerId: "00-0037834", firstSeason: 2022 } as const;

export const PURDY_SHRINE_FILES = {
  "love-letter": (gameWeek: string) => `purdy-shrine/love-letters/${gameWeek}.md`,
  "reasons-we-love-brock": "purdy-shrine/reasons.md",
  "purdy-stat-tracker": "purdy-shrine/stat-tracker.md",
  "origin-story": "purdy-shrine/origin-story.md",
} as const;

const gameWeekSlug = z.string().regex(/^\d{4}-[a-z0-9-]+$/, "expected a Game Week slug such as 2026-week-12");
const score = z.number().int().nonnegative();
const venue = z.enum(["home", "away", "neutral"]);
const result = z.object({ sf: score, opponent: score });

/**
 * Which Love Letter it is: adoring when Purdy played, "we miss you" when he didn't (DNP). The
 * pipeline sets it from his nflverse lines against the schedule; the writer can't choose it.
 */
export const LOVE_LETTER_VARIANTS = ["adoring", "we-miss-you"] as const;
export type LoveLetterVariant = (typeof LOVE_LETTER_VARIANTS)[number];

/**
 * The Love Letter: the Purdy Shrine's weekly piece, written the day after each game. Every
 * number it states is a cited stat of Purdy's in `stats` (the stat check compares them with
 * nflverse), and every injury status it mentions is in `injuries` (the injury check compares
 * them with the official report). The pipeline fills in the game, its score, and the variant.
 */
export const loveLetterSchema = z
  .object({
    title: z.string().min(1),
    date: isoDate,
    variant: z.enum(LOVE_LETTER_VARIANTS),
    gameWeek: gameWeekSlug,
    gameId: z.string().min(1),
    season: z.number().int(),
    week: z.number().int(),
    gameType: z.enum(GAME_TYPES),
    opponent: z.string().min(1),
    venue,
    result,
    stats: z.array(citedStat).optional(),
    injuries: z.array(injuryStatus).optional(),
    sources: z.array(z.object({ url: z.url({ protocol: /^https?$/ }), outlet: z.string().min(1) })).optional(),
    quotes: z.array(quote).optional(),
  })
  .superRefine((letter, ctx) => {
    letter.stats?.forEach((stat, i) => {
      if (stat.player !== PURDY.player) ctx.addIssue({ code: "custom", path: ["stats", i, "player"], message: `a Love Letter stat must be ${PURDY.player}'s` });
    });
    letter.injuries?.forEach((injury, i) => {
      if (injury.player !== PURDY.player) ctx.addIssue({ code: "custom", path: ["injuries", i, "player"], message: `a Love Letter mentions only ${PURDY.player}'s injury status` });
    });
    const linked = new Set(letter.sources?.map((source) => source.url));
    letter.quotes?.forEach((q, i) => {
      if (!linked.has(q.source)) ctx.addIssue({ code: "custom", path: ["quotes", i, "source"], message: "a quote must come from one of the sources" });
    });
  });

export type LoveLetterData = z.infer<typeof loveLetterSchema>;

/**
 * Reasons We Love Brock: one running list, `purdy-shrine/reasons.md`. The post-game job adds
 * one reason a game, at the end, dated and tied to the game's Game Week. A reason is in our own
 * words and states no numbers, since it has no cited stats for the stat check to hold it to.
 * The Markdown body is an optional hand-written introduction, which updates keep.
 */
export const reasonsWeLoveBrockSchema = z
  .object({
    title: z.string().min(1),
    updated: isoDate,
    reasons: z
      .array(z.object({ reason: z.string().min(1), added: isoDate, gameWeek: gameWeekSlug.optional() }))
      .min(1, "the list needs a reason"),
  })
  .superRefine((list, ctx) => {
    const seen = new Set<string>();
    list.reasons.forEach((item, i) => {
      const key = item.reason.toLowerCase().replace(/[^a-z]+/g, " ").trim();
      if (seen.has(key)) ctx.addIssue({ code: "custom", path: ["reasons", i, "reason"], message: "the list already has this reason" });
      seen.add(key);
      if (/\d/.test(item.reason)) {
        ctx.addIssue({ code: "custom", path: ["reasons", i, "reason"], message: "a reason states no numbers (stats go in the stat tracker and the Love Letter)" });
      }
    });
  });

export type ReasonsWeLoveBrockData = z.infer<typeof reasonsWeLoveBrockSchema>;
