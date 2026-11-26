// Seam 2 for the Purdy Shrine: the Shrine page, each Love Letter's page, and the newest Love
// Letter on the homepage. The content folder is written by the publish pipeline (two post-game
// runs with fake adapters: Week 10, which Purdy played, and Week 11, which here he didn't), plus
// the hand-written origin story seeded in the repo's content folder.
import { copyFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runJob, type DraftEntry, type SourceSnapshot } from "../src/pipeline";
import { readEntry } from "../src/pipeline/content-store";
import { buildSite, type BuiltSite } from "./support/built-site";
import { fakeSources, fakeWriter, recordedSnapshot, withPurdyCareer } from "./support/fakes";

const recorded = recordedSnapshot("thursday-preview-2026-11-26");
const WEEK_11 = "2026_11_MIN_SF";
/** Purdy has no line from Week 11 here: a DNP. */
const snapshot: SourceSnapshot = withPurdyCareer({
  ...recorded,
  stats: { ...recorded.stats!, players: recorded.stats!.players.filter((line) => !(line.player === "Brock Purdy" && line.gameId === WEEK_11)) },
});

const seasonStats: DraftEntry = {
  type: "season-stats",
  data: { stats: [{ team: "SF", stat: "rushing_yards", scope: { type: "season", season: 2026 }, value: 1386, label: "Rushing yards" }] },
  body: "The season in numbers.",
};
const highlights = (gameId: string): DraftEntry => ({
  type: "highlights",
  data: {
    title: "Kittle again",
    standouts: [{ player: "George Kittle", team: "SF", writeUp: "Kittle being Kittle." }],
    stats: [{ player: "George Kittle", team: "SF", stat: "receptions", scope: { type: "game", gameId }, value: gameId === WEEK_11 ? 3 : 6, label: "Receptions" }],
  },
  body: "A win.",
});

const week10Letter: DraftEntry = {
  type: "love-letter",
  data: { title: "Dear Brock, about Dallas" },
  body: "You were magnificent in Dallas, and we told everyone.",
};
const week11Letter: DraftEntry = {
  type: "love-letter",
  data: { title: "Dear Brock, we missed you" },
  body: "Mexico City was lovely, but it was not the same without you.",
};

describe("built site (Purdy Shrine)", () => {
  let contentDir: string;
  let site: BuiltSite;

  beforeAll(async () => {
    contentDir = await mkdtemp(path.join(tmpdir(), "gold-blooded-shrine-"));
    const runs: [string, DraftEntry[]][] = [
      ["2026-11-16", [highlights("2026_10_SF_DAL"), seasonStats, week10Letter, { type: "reasons-we-love-brock", data: { reason: "He makes the hard throws look easy." }, body: "" }]],
      ["2026-11-23", [highlights(WEEK_11), seasonStats, week11Letter, { type: "reasons-we-love-brock", data: { reason: "Even on the sideline, he is the first to cheer." }, body: "" }]],
    ];
    for (const [date, drafts] of runs) {
      // Each run reads the reasons list as the last one left it, as the real sources do.
      const reasons = await readEntry(contentDir, "purdy-shrine/reasons.md");
      const current = reasons ? { "reasons-we-love-brock": reasons as never } : {};
      const result = await runJob({ job: "post-game", date, sources: fakeSources({ ...snapshot, current }), writer: fakeWriter(drafts), contentDir });
      expect(result.status, JSON.stringify(result)).toBe("published");
    }
    await mkdir(path.join(contentDir, "purdy-shrine"), { recursive: true });
    const seeded = fileURLToPath(new URL("../content/purdy-shrine/origin-story.md", import.meta.url));
    await copyFile(seeded, path.join(contentDir, "purdy-shrine", "origin-story.md"));
    site = await buildSite(contentDir);
  }, 120_000);

  afterAll(async () => {
    await site?.cleanup();
    if (contentDir) await rm(contentDir, { recursive: true, force: true });
  });

  it("shows the newest Love Letter on the homepage, as a \"we miss you\" letter, linking to it", async () => {
    const html = await site.html("/gold-blooded/");
    const lead = html.match(/<section[^>]*class="love-letter-lead"[^>]*>([\s\S]*?)<\/section>/)?.[1] ?? "";

    expect(text(lead)).toContain("Love Letter");
    expect(text(lead)).toContain("We miss you");
    expect(text(lead)).toContain("Dear Brock, we missed you");
    expect(text(lead)).toContain("Mexico City was lovely, but it was not the same without you.");
    expect(lead).toContain('href="/gold-blooded/purdy-shrine/love-letters/2026-week-11/"');
    expect(text(lead)).not.toContain("about Dallas");
  });

  it("gives every Love Letter its own page", async () => {
    const page = text(await site.html("/gold-blooded/purdy-shrine/love-letters/2026-week-10/"));

    expect(page).toContain("Dear Brock, about Dallas");
    expect(page).toContain("2026 Week 10, at DAL, won 46-40");
    expect(page).toContain("You were magnificent in Dallas, and we told everyone.");
    expect(page).not.toContain("We miss you");
  });

  it("is a real Shrine page: the newest Love Letter, then every letter", async () => {
    const page = text(await site.html("/gold-blooded/purdy-shrine/"));

    expect(page).not.toContain("Coming soon");
    expect(page).toContain("Dear Brock, we missed you");
    expect(page).toContain("All Love Letters");
    expect(page.indexOf("Dear Brock, we missed you")).toBeLessThan(page.indexOf("Dear Brock, about Dallas"));
  });

  it("has the origin story, Mr. Irrelevant to Mr. Everything", async () => {
    const page = text(await site.html("/gold-blooded/purdy-shrine/"));

    expect(page).toContain("Mr. Irrelevant to Mr. Everything");
    expect(page).toContain("262nd");
  });

  it("lists the Reasons We Love Brock, oldest first", async () => {
    const html = await site.html("/gold-blooded/purdy-shrine/");
    const list = html.match(/<ol[^>]*class="reasons"[^>]*>([\s\S]*?)<\/ol>/)?.[1] ?? "";

    expect([...list.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/g)].map((m) => text(m[1]!))).toEqual([
      "He makes the hard throws look easy.",
      "Even on the sideline, he is the first to cheer.",
    ]);
  });

  it("shows the stat tracker: each season, his career, and DNP for the game he missed", async () => {
    const html = await site.html("/gold-blooded/purdy-shrine/");
    const tracker = text(html.match(/<section[^>]*class="stat-tracker"[^>]*>([\s\S]*?)<\/section>/)?.[1] ?? "");

    expect(tracker).toContain("Brock Purdy Stat Tracker");
    // Season, games, played, DNP, then the stats: Cmp, Att, Cmp%, Yds, Y/A, TD, INT, Rush Yds, Rush TD.
    expect(tracker).toContain("2022 1 1 0 20 30 66.7 185 6.2 2 1 10 0");
    expect(tracker).toContain("2026 10 9 1 185 264 70.1 2,369 9.0 20 5 222 2");
    expect(tracker).toContain("Career 32 13 19");
    expect(tracker).toContain("Week 11 vs MIN (neutral site) Won 35-10 DNP");
    expect(tracker).toContain("Week 10 at DAL Won 46-40");
  });

  it("leaves a slot for Purdy's Film Room entries, empty until there are some", async () => {
    const html = await site.html("/gold-blooded/purdy-shrine/");

    expect(html).not.toContain('class="purdy-film-room"');
  });
});

describe("built site (Purdy Shrine with no content yet)", () => {
  let site: BuiltSite;
  beforeAll(async () => {
    site = await buildSite("empty");
  }, 120_000);
  afterAll(async () => site?.cleanup());

  it("still has a Shrine page, and no Love Letter on the homepage", async () => {
    const page = text(await site.html("/gold-blooded/purdy-shrine/"));

    expect(page).not.toContain("Coming soon");
    expect(page).toContain("No Love Letters yet");
    expect(await site.html("/gold-blooded/")).not.toContain("love-letter-lead");
  });
});

function text(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .replace(/ ([,.])/g, "$1")
    .trim();
}
