// Seam 2 for Game Week Pages and the homepage's Game Preview. The content folder is written
// by the publish pipeline's Thursday preview job (with fake adapters), so these tests also
// prove the site reads what the pipeline writes.
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runJob, type DraftEntry } from "../src/pipeline";
import { buildSite, type BuiltSite } from "./support/built-site";
import { fakeSources, fakeWriter, recordedSnapshot } from "./support/fakes";

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

// The recorded snapshot's nflverse lines run through Week 11, whichever week the run is for.
const PURDY_SEASON = { player: "Brock Purdy", team: "SF", stat: "passing_yards", scope: { type: "season", season: 2026 }, value: 2624, label: "Passing yards" };
const SEATTLE_STATS = [
  PURDY_SEASON,
  { player: "Jaxon Smith-Njigba", team: "SEA", stat: "receiving_yards", scope: { type: "last-games", season: 2026, games: 3 }, value: 340, label: "Receiving yards" },
  { team: "SF", stat: "rushing_yards", scope: { type: "season", season: 2026 }, per: "game", value: 138.6, label: "Rushing yards" },
  { team: "SEA", stat: "rushing_yards", scope: { type: "season", season: 2026 }, per: "game", value: 114.7, label: "Rushing yards" },
];

function breakdown(title: string, stats: object[]): DraftEntry {
  return { type: "stat-breakdown", data: { title, stats, trends: [`${title}: the trend.`] }, body: `${title}, in full.` };
}

const recap: DraftEntry = { type: "season-recap", data: { title: "Six and one at the bye", sources: [SOURCE] }, body: "A strong first half." };

describe("built site (Game Week Pages)", () => {
  let contentDir: string;
  let site: BuiltSite;

  beforeAll(async () => {
    contentDir = await mkdtemp(path.join(tmpdir(), "gold-blooded-game-weeks-"));
    const runs: [string, DraftEntry[]][] = [
      ["2026-10-29", [recap]],
      ["2026-11-19", [preview("Minnesota in Mexico City", { sf: 24, opponent: 17 }), breakdown("Minnesota by the numbers", [PURDY_SEASON])]],
      ["2026-11-26", [preview("Seattle with the West on the line", { sf: 27, opponent: 20 }), breakdown("Seattle by the numbers", SEATTLE_STATS)]],
    ];
    for (const [date, drafts] of runs) {
      const result = await runJob({ job: "thursday-preview", date, sources: fakeSources(snapshot), writer: fakeWriter(drafts), contentDir });
      expect(result.status).toBe("published");
    }
    site = await buildSite(contentDir);
  }, 120_000);

  afterAll(async () => {
    await site?.cleanup();
    if (contentDir) await rm(contentDir, { recursive: true, force: true });
  });

  it("leads the homepage with the current Game Preview, linking to its Game Week Page", async () => {
    const html = await site.html("/gold-blooded/");
    const lead = html.match(/<section[^>]*class="game-preview-lead"[^>]*>([\s\S]*?)<\/section>/)?.[1] ?? "";

    expect(text(lead)).toContain("Seattle with the West on the line");
    expect(text(lead)).not.toContain("Minnesota in Mexico City");
    expect(lead).toContain('href="/gold-blooded/game-weeks/2026-week-12/"');
    expect(html.indexOf('class="game-preview-lead"')).toBeLessThan(html.indexOf('class="section-cards"'));
  });

  it("shows a countdown to the current game's kickoff on the homepage", async () => {
    const html = await site.html("/gold-blooded/");
    const countdown = html.match(/<[^>]*class="countdown"[^>]*>/)?.[0] ?? "";

    expect(countdown).toContain('data-kickoff="2026-11-29T21:25:00.000Z"');
    expect(text(html)).toMatch(/Kickoff:? Sun(day)?, Nov(ember)? 29, 1:25 PM PT/);
  });

  it("puts the Game Preview on its Game Week Page: storylines, keys, and the prediction", async () => {
    const page = text(await site.html("/gold-blooded/game-weeks/2026-week-12/"));

    expect(page).toContain("Seattle with the West on the line");
    expect(page).toContain("Seattle with the West on the line: the storyline.");
    expect(page).toContain("Seattle with the West on the line: the key.");
    expect(page).toContain("Prediction: 49ers 27, SEA 20");
    expect(page).toContain("Seattle with the West on the line, in full.");
  });

  it("puts the Stat Breakdown on its Game Week Page: the teams side by side, the players, and the trends", async () => {
    const html = await site.html("/gold-blooded/game-weeks/2026-week-12/");
    const section = html.match(/<article[^>]*class="stat-breakdown"[^>]*>([\s\S]*?)<\/article>/)?.[1] ?? "";
    const rows = [...section.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)].map((row) => text(row[1]!).trim());

    expect(text(section)).toContain("Stat Breakdown: Seattle by the numbers");
    expect(text(section)).toContain("Seattle by the numbers, in full.");
    expect(text(section)).toContain("Seattle by the numbers: the trend.");
    expect(rows).toContain("Rushing yards per game, 2026 season 138.6 114.7");
    expect(rows).toContain("Brock Purdy SF Passing yards, 2026 season 2,624");
    expect(rows).toContain("Jaxon Smith-Njigba SEA Receiving yards, last 3 games 340");
    expect(text(section)).toMatch(/Stats: nflverse/);
    expect(html.indexOf('class="game-preview"')).toBeLessThan(html.indexOf('class="stat-breakdown"'));
  });

  it("gives every Game Week its own page, including the Bye Week's season recap", async () => {
    const pages = await site.pagePaths();
    expect(pages).toEqual(
      expect.arrayContaining([
        "/gold-blooded/game-weeks/2026-week-08/",
        "/gold-blooded/game-weeks/2026-week-11/",
        "/gold-blooded/game-weeks/2026-week-12/",
      ]),
    );

    const bye = text(await site.html("/gold-blooded/game-weeks/2026-week-08/"));
    expect(bye).toContain("Bye Week");
    expect(bye).toContain("Six and one at the bye");
    expect(bye).toContain("6-1");
    expect(bye).not.toContain("Prediction");
  });
});

function text(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#39;|&#x27;|&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");
}
