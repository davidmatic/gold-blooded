// The News Summary content type (GLOSSARY.md). One Markdown file per summary under
// `content/news/`, with this frontmatter. The site's content collection and the publish
// pipeline both validate against this schema.
import { z } from "astro/zod";

export const NEWS_CATEGORIES = ["Injury", "Personnel", "Practice Report", "Coach's Comments"] as const;
export type NewsCategory = (typeof NEWS_CATEGORIES)[number];

const isoDate = z.preprocess(
  // YAML turns an unquoted 2026-11-25 into a Date; accept that from hand-edited files.
  (value) => (value instanceof Date ? value.toISOString().slice(0, 10) : value),
  z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected a YYYY-MM-DD date"),
);

/** Practice participation on the official injury report: did not, limited, full. */
export const PRACTICE_STATUSES = ["DNP", "LP", "FP"] as const;
export type PracticeStatus = (typeof PRACTICE_STATUSES)[number];

/** Game designations on the official injury report. */
export const GAME_STATUSES = ["Out", "Doubtful", "Questionable"] as const;
export type GameStatus = (typeof GAME_STATUSES)[number];

/**
 * An injury status the summary states for one player. The injury publish check compares
 * each stated status with the official report, so the writer must list every player whose
 * status the body mentions.
 */
const injuryStatus = z
  .object({
    player: z.string().min(1),
    practiceStatus: z.enum(PRACTICE_STATUSES).optional(),
    gameStatus: z.enum(GAME_STATUSES).optional(),
  })
  .refine((injury) => injury.practiceStatus || injury.gameStatus, "state a practiceStatus, a gameStatus, or both");

export const newsSummarySchema = z
  .object({
    title: z.string().min(1),
    category: z.enum(NEWS_CATEGORIES),
    date: isoDate,
    sources: z
      .array(z.object({ url: z.url({ protocol: /^https?$/ }), outlet: z.string().min(1) }))
      .min(1, "a News Summary must link to its source"),
    injuries: z.array(injuryStatus).optional(),
  })
  .refine((summary) => summary.category !== "Injury" || (summary.injuries?.length ?? 0) > 0, {
    path: ["injuries"],
    message: "an Injury summary must state the injury statuses it reports",
  });

export type NewsSummaryData = z.infer<typeof newsSummarySchema>;
