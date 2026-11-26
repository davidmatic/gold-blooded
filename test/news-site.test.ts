// Seam 2 for News Summaries. The content folder is written by the publish pipeline
// (with fake adapters), so these tests also prove the site reads what the pipeline writes.
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runJob, type DraftEntry } from "../src/pipeline";
import { buildSite, type BuiltSite } from "./support/built-site";
import { fakeSources, fakeWriter, recordedSnapshot } from "./support/fakes";

const snapshot = recordedSnapshot("daily-news-2026-11-25");

function draft(title: string, category: string, body = `${title}.`): DraftEntry {
  return {
    type: "news-summary",
    data: { title, category, sources: [{ url: `https://www.49ers.com/news/${title.toLowerCase().replace(/\W+/g, "-")}`, outlet: "49ers.com" }] },
    body,
  };
}

describe("built site (News Summaries)", () => {
  let contentDir: string;
  let site: BuiltSite;

  beforeAll(async () => {
    contentDir = await mkdtemp(path.join(tmpdir(), "gold-blooded-news-"));
    const days: [string, DraftEntry[]][] = [
      ["2026-11-23", [draft("Old injury news", "Injury"), draft("Old practice notes", "Practice Report")]],
      [
        "2026-11-25",
        [
          draft("Corner signed to practice squad", "Personnel"),
          draft("Shanahan on third downs", "Coach's Comments"),
          draft("Warner misses practice", "Injury"),
        ],
      ],
    ];
    for (const [date, drafts] of days) {
      const result = await runJob({ job: "daily-news", date, sources: fakeSources(snapshot), writer: fakeWriter(drafts), contentDir });
      expect(result.status).toBe("published");
    }
    site = await buildSite(contentDir);
  }, 120_000);

  afterAll(async () => {
    await site?.cleanup();
    if (contentDir) await rm(contentDir, { recursive: true, force: true });
  });

  it("pins Injury summaries on top of the homepage's latest News Summaries", async () => {
    const latest = summaries(await site.html("/gold-blooded/"));
    expect(latest.map((s) => s.title)).toEqual([
      "Warner misses practice",
      "Old injury news",
      "Corner signed to practice squad",
      "Shanahan on third downs",
      "Old practice notes",
    ]);
  });

  it("lists every News Summary on the News page, newest first, linking to its source", async () => {
    const html = await site.html("/gold-blooded/news/");
    // Same-day summaries follow category order: Injury, Personnel, Practice Report, Coach's Comments.
    expect(summaries(html).map((s) => s.title)).toEqual([
      "Warner misses practice",
      "Corner signed to practice squad",
      "Shanahan on third downs",
      "Old injury news",
      "Old practice notes",
    ]);
    expect(html).toContain('href="https://www.49ers.com/news/warner-misses-practice"');
  });

  it("filters the News page by category", async () => {
    const filters = categoryLinks(await site.html("/gold-blooded/news/"));
    expect(filters).toEqual([
      { text: "All", href: "/gold-blooded/news/" },
      { text: "Injury", href: "/gold-blooded/news/injury/" },
      { text: "Personnel", href: "/gold-blooded/news/personnel/" },
      { text: "Practice Report", href: "/gold-blooded/news/practice-report/" },
      { text: "Coach's Comments", href: "/gold-blooded/news/coachs-comments/" },
    ]);

    const injury = summaries(await site.html("/gold-blooded/news/injury/"));
    expect(injury.map((s) => s.title)).toEqual(["Warner misses practice", "Old injury news"]);
    expect(injury.every((s) => s.category === "Injury")).toBe(true);
  });
});

function decode(text: string): string {
  return text
    .replace(/<[^>]+>/g, "")
    .replace(/&#39;|&#x27;|&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .trim();
}

function summaries(html: string): { title: string; category: string }[] {
  return [...html.matchAll(/<article[^>]*class="news-summary"[^>]*>([\s\S]*?)<\/article>/g)].map((m) => ({
    title: decode(m[1]!.match(/<h3[^>]*>([\s\S]*?)<\/h3>/)?.[1] ?? ""),
    category: decode(m[1]!.match(/class="news-category"[^>]*>([\s\S]*?)</)?.[1] ?? ""),
  }));
}

function categoryLinks(html: string): { text: string; href: string }[] {
  const nav = html.match(/<nav[^>]*aria-label="News categories"[^>]*>([\s\S]*?)<\/nav>/)?.[1] ?? "";
  return [...nav.matchAll(/<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)].map((m) => ({ href: m[1]!, text: decode(m[2]!) }));
}
