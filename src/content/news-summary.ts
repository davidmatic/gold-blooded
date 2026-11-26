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

export const newsSummarySchema = z.object({
  title: z.string().min(1),
  category: z.enum(NEWS_CATEGORIES),
  date: isoDate,
  sources: z
    .array(z.object({ url: z.url({ protocol: /^https?$/ }), outlet: z.string().min(1) }))
    .min(1, "a News Summary must link to its source"),
});

export type NewsSummaryData = z.infer<typeof newsSummarySchema>;
