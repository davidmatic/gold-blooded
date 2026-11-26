// Seam 2 for the Film Room: the Film Room page and the newest entry on the homepage. The content
// folder is written by the publish pipeline: two Film Room runs with fake adapters, one of them
// for a QB School video whose captions couldn't be fetched.
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildSite, type BuiltSite } from "./support/built-site";
import { JFA_EPISODE, PURDY_VIDEO, publishFilmRoom } from "./support/film-room";

describe("built site (Film Room)", () => {
  let contentDir: string;
  let site: BuiltSite;

  beforeAll(async () => {
    contentDir = await mkdtemp(path.join(tmpdir(), "gold-blooded-film-room-"));
    await publishFilmRoom(contentDir);
    site = await buildSite(contentDir);
  }, 120_000);

  afterAll(async () => {
    await site?.cleanup();
    if (contentDir) await rm(contentDir, { recursive: true, force: true });
  });

  it("is a real Film Room page listing every entry, newest first", async () => {
    const page = text(await site.html("/gold-blooded/film-room/"));

    expect(page).not.toContain("Coming soon");
    const order = ["Purdy's three touchdowns in Mexico City", "The three amigos", "Shanahan's play-action, frame by frame"].map((title) => page.indexOf(title));
    expect(order.every((at) => at >= 0)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it("credits each entry to its show and links to the original", async () => {
    const html = await site.html("/gold-blooded/film-room/");
    const entry = article(html, "The three amigos");

    expect(text(entry)).toContain("Jonnydel's Football Academy");
    expect(text(entry)).toContain("On Jonnydel's Football Academy, Jonnydel credits McCaffrey and Kittle.");
    expect(entry).toContain(`href="${JFA_EPISODE}"`);
    expect(text(entry)).toContain("Listen to the original: JFA Podcast 355: Victory Monday");
  });

  it("says when an entry was written from the video's title and description alone", async () => {
    const html = await site.html("/gold-blooded/film-room/");
    const uncaptioned = text(article(html, "Purdy's three touchdowns in Mexico City"));
    const captioned = text(article(html, "Shanahan's play-action, frame by frame"));

    expect(uncaptioned).toContain("The QB School");
    expect(uncaptioned).toContain("Watch the original: Brock Purdy vs the Vikings Week 11, 2026 Analysis");
    expect(uncaptioned).toContain("Written from the video's title and description");
    expect(captioned).not.toContain("Written from the video's title and description");
  });

  it("shows the newest Film Room entry on the homepage, linking to the Film Room", async () => {
    const html = await site.html("/gold-blooded/");
    const lead = html.match(/<section[^>]*class="film-room-lead"[^>]*>([\s\S]*?)<\/section>/)?.[1] ?? "";

    expect(text(lead)).toContain("Purdy's three touchdowns in Mexico City");
    expect(text(lead)).toContain("The QB School");
    expect(lead).toContain(`href="${PURDY_VIDEO}"`);
    expect(lead).toContain('href="/gold-blooded/film-room/"');
    expect(text(lead)).not.toContain("The three amigos");
  });
});

describe("built site (Film Room with no entries yet)", () => {
  let site: BuiltSite;
  beforeAll(async () => {
    site = await buildSite("empty");
  }, 120_000);
  afterAll(async () => site?.cleanup());

  it("still has a Film Room page, and no Film Room entry on the homepage", async () => {
    const page = text(await site.html("/gold-blooded/film-room/"));

    expect(page).not.toContain("Coming soon");
    expect(page).toContain("No Film Room entries yet");
    expect(await site.html("/gold-blooded/")).not.toContain("film-room-lead");
  });
});

/** The Film Room page's article for the entry with this title. */
function article(html: string, title: string): string {
  const articles = [...html.matchAll(/<article[^>]*class="film-room-entry"[^>]*>([\s\S]*?)<\/article>/g)].map((m) => m[1]!);
  return articles.find((a) => text(a).includes(title)) ?? "";
}

function text(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#39;|’/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .replace(/ ([,.:])/g, "$1")
    .trim();
}
