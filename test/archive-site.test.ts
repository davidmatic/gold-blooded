// Seam 2 for the Archive: past Game Week Pages, newest first. The content folder is written by
// the publish pipeline's Thursday preview job (with fake adapters). The build's clock is pinned,
// since "past" depends on it: a Game Week is past once its game has kicked off, or once a newer
// Game Week Page exists.
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runJob, type DraftEntry } from "../src/pipeline";
import { buildSite, type BuiltSite } from "./support/built-site";
import { fakeSources, fakeWriter, recordedSnapshot, sfStatBreakdown } from "./support/fakes";

const snapshot = recordedSnapshot("thursday-preview-2026-11-26");
const SOURCE = { url: "https://www.49ers.com/news/injury-report-wednesday-week-13", outlet: "49ers.com" };

function preview(title: string, prediction: { sf: number; opponent: number }): DraftEntry {
  return {
    type: "game-preview",
    data: {
      title,
      storylines: [`${title}: the storyline.`],
      keys: [`${title}: the key.`],
      prediction: { winner: "SF", score: prediction },
      sources: [SOURCE],
    },
    body: `${title}, in full.`,
  };
}

const recap: DraftEntry = { type: "season-recap", data: { title: "Six and one at the bye", sources: [SOURCE] }, body: "A strong first half." };

// Week 12 (vs SEA) kicks off 2026-11-29T21:25Z.
const BEFORE_WEEK_12 = "2026-11-27T12:00:00.000Z";
const AFTER_WEEK_12 = "2026-11-30T12:00:00.000Z";

describe("built site (Archive)", () => {
  let contentDir: string;
  let site: BuiltSite;
  let later: BuiltSite;

  beforeAll(async () => {
    contentDir = await mkdtemp(path.join(tmpdir(), "gold-blooded-archive-"));
    const runs: [string, DraftEntry][] = [
      ["2026-10-29", recap],
      ["2026-11-19", preview("Minnesota in Mexico City", { sf: 24, opponent: 17 })],
      ["2026-11-26", preview("Seattle with the West on the line", { sf: 27, opponent: 20 })],
    ];
    for (const [date, draft] of runs) {
      const result = await runJob({ job: "thursday-preview", date, sources: fakeSources(snapshot), writer: fakeWriter(draft.type === "game-preview" ? [draft, sfStatBreakdown] : [draft]), contentDir });
      expect(result.status).toBe("published");
    }
    site = await buildSite(contentDir, { now: BEFORE_WEEK_12 });
    later = await buildSite(contentDir, { now: AFTER_WEEK_12 });
  }, 180_000);

  afterAll(async () => {
    await site?.cleanup();
    await later?.cleanup();
    if (contentDir) await rm(contentDir, { recursive: true, force: true });
  });

  it("lists every past Game Week Page, newest first, leaving out the upcoming week", async () => {
    const links = archiveLinks(await site.html("/gold-blooded/archive/"));

    expect(links.map((link) => link.href)).toEqual(["/gold-blooded/game-weeks/2026-week-11/", "/gold-blooded/game-weeks/2026-week-08/"]);
    expect(links[0]!.text).toContain("2026 Week 11");
    expect(links[0]!.text).toContain("Minnesota in Mexico City");
    expect(links[1]!.text).toContain("Bye Week");
  });

  it("adds a Game Week to the Archive once its game has kicked off", async () => {
    const links = archiveLinks(await later.html("/gold-blooded/archive/"));

    expect(links.map((link) => link.href)).toEqual([
      "/gold-blooded/game-weeks/2026-week-12/",
      "/gold-blooded/game-weeks/2026-week-11/",
      "/gold-blooded/game-weeks/2026-week-08/",
    ]);
  });

  it("is linked from the homepage, and every Archive link resolves", async () => {
    expect(await site.html("/gold-blooded/")).toMatch(/<a\b[^>]*href="\/gold-blooded\/archive\/"/);

    for (const built of [site, later]) {
      const pages = await built.pagePaths();
      for (const link of archiveLinks(await built.html("/gold-blooded/archive/"))) {
        expect(pages, `${link.text} -> ${link.href}`).toContain(link.href);
      }
    }
  });

  it("is no longer a Coming soon placeholder", async () => {
    expect(text(await site.html("/gold-blooded/archive/"))).not.toContain("Coming soon");
  });
});

function archiveLinks(html: string): { href: string; text: string }[] {
  const list = html.match(/<ol[^>]*class="archive-list"[^>]*>([\s\S]*?)<\/ol>/)?.[1] ?? "";
  return [...list.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/g)].map((item) => ({
    href: item[1]!.match(/<a\b[^>]*href="([^"]+)"/)?.[1] ?? "",
    text: text(item[1]!),
  }));
}

function text(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#39;|&#x27;|&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");
}
