// Ordering and filtering of News Summaries for the News page and the homepage.
import { NEWS_CATEGORIES, type NewsCategory, type NewsSummaryData } from "../content/news-summary";

export const HOMEPAGE_NEWS_LIMIT = 8;

/** URL slug for a category, e.g. "Coach's Comments" -> "coachs-comments". */
export function categorySlug(category: NewsCategory): string {
  return category.toLowerCase().replace(/'/g, "").replace(/[^a-z0-9]+/g, "-");
}

export const newsCategories = NEWS_CATEGORIES.map((name) => ({ name, slug: categorySlug(name) }));

interface HasData {
  id: string;
  data: NewsSummaryData;
}

/** Newest first; ties keep category order, then id, so builds are stable. */
export function newestFirst<T extends HasData>(entries: readonly T[]): T[] {
  return [...entries].sort(
    (a, b) =>
      b.data.date.localeCompare(a.data.date) ||
      NEWS_CATEGORIES.indexOf(a.data.category) - NEWS_CATEGORIES.indexOf(b.data.category) ||
      a.id.localeCompare(b.id),
  );
}

/** The homepage's latest News Summaries, with Injury summaries pinned on top. */
export function homepageNews<T extends HasData>(entries: readonly T[], limit = HOMEPAGE_NEWS_LIMIT): T[] {
  const latest = newestFirst(entries).slice(0, limit);
  return [...latest.filter((e) => e.data.category === "Injury"), ...latest.filter((e) => e.data.category !== "Injury")];
}
