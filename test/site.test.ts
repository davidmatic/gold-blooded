import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildSite, type BuiltSite } from "./support/built-site";

describe("built site (empty content)", () => {
  let site: BuiltSite;

  beforeAll(async () => {
    site = await buildSite("empty");
  }, 120_000);

  afterAll(() => site?.cleanup());

  it("serves the homepage under the /gold-blooded/ base path", async () => {
    const html = await site.html("/gold-blooded/");
    expect(html).toContain("Gold Blooded");
  });

  it("puts the unofficial-site disclaimer in the footer of every page", async () => {
    const pages = await site.pagePaths();
    expect(pages.length).toBeGreaterThan(0);
    for (const page of pages) {
      const footer = footerText(await site.html(page));
      expect(footer, `footer on ${page}`).toMatch(/unofficial/i);
      expect(footer, `footer on ${page}`).toMatch(/not affiliated with the San Francisco 49ers or the NFL/i);
    }
  });

  it("links from the homepage to every section, and every link resolves", async () => {
    const nav = navLinks(await site.html("/gold-blooded/"));
    expect(nav.map((link) => link.text)).toEqual([
      "News",
      "Season Stats",
      "Purdy Shrine",
      "Film Room",
      "Archive",
    ]);
    const pages = await site.pagePaths();
    for (const link of nav) {
      expect(pages, `${link.text} -> ${link.href}`).toContain(link.href);
    }
  });

  it("ships no logo or wordmark assets", async () => {
    const offending = (await site.files()).filter((file) => OFFICIAL_BRAND_ASSET.test(file));
    expect(offending).toEqual([]);
  });

  it("references no logo or wordmark assets from any page", async () => {
    for (const page of await site.pagePaths()) {
      const refs = assetReferences(await site.html(page));
      expect(refs.filter((ref) => OFFICIAL_BRAND_ASSET.test(ref)), `assets on ${page}`).toEqual([]);
    }
  });
});

const OFFICIAL_BRAND_ASSET = /logo|wordmark/i;

function navLinks(html: string): { text: string; href: string }[] {
  const nav = html.match(/<nav[^>]*aria-label="Site"[^>]*>([\s\S]*?)<\/nav>/i)?.[1] ?? "";
  return [...nav.matchAll(/<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)].map((m) => ({
    href: m[1]!,
    text: m[2]!.replace(/<[^>]+>/g, "").trim(),
  }));
}

function assetReferences(html: string): string[] {
  return [...html.matchAll(/\b(?:src|href|srcset|poster)\s*=\s*["']([^"']+)["']/gi)].map((m) => m[1]!);
}

function footerText(html: string): string {
  const match = html.match(/<footer[\s\S]*?<\/footer>/i);
  return match ? match[0].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ") : "";
}
