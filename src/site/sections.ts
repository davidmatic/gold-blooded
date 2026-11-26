// The site's top-level sections, in navigation order. Names follow GLOSSARY.md.
export interface Section {
  name: string;
  slug: string;
  blurb: string;
}

export const sections: readonly Section[] = [
  { name: "News", slug: "news", blurb: "Daily News Summaries: Injury, Personnel, Practice Report, and Coach's Comments." },
  { name: "Season Stats", slug: "season-stats", blurb: "Team and player numbers for the season, plus the Prediction Record." },
  { name: "Purdy Shrine", slug: "purdy-shrine", blurb: "The weekly Love Letter and everything else we adore about Brock Purdy." },
  { name: "Film Room", slug: "film-room", blurb: "Credited summaries of The QB School and Jonnydel's Football Academy breakdowns." },
  { name: "Archive", slug: "archive", blurb: "Past Game Week Pages." },
];

/** A site path under the configured base, e.g. `sitePath("news")` -> `/gold-blooded/news/`. */
export function sitePath(slug = ""): string {
  const base = import.meta.env.BASE_URL.replace(/\/?$/, "/");
  return slug ? `${base}${slug.replace(/^\/|\/$/g, "")}/` : base;
}
