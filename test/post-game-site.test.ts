// Seam 2 for the post-game job's content: Highlights on the Game Week Page and the Season Stats
// page. The content folder is written by the publish pipeline (with fake adapters), so these
// tests also prove the site reads what the pipeline writes.
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runJob, type DraftEntry, type SourceSnapshot } from "../src/pipeline";
import { buildSite, type BuiltSite } from "./support/built-site";
import { fakeSources, fakeWriter, recordedSnapshot, sfStatBreakdown } from "./support/fakes";

const GAME = "2026_11_MIN_SF";
const snapshot: SourceSnapshot = {
  ...recordedSnapshot("thursday-preview-2026-11-26"),
  videos: [
    {
      videoId: "Id7LlG3tijo",
      title: "Mic’d Up: Warner and Kittle Take Over Mexico City | 49ers",
      channel: "San Francisco 49ers",
      url: "https://www.youtube.com/watch?v=Id7LlG3tijo",
      publishedAt: "2026-11-23T01:00:06+00:00",
      description: "Wired for sound.",
    },
  ],
};

const preview: DraftEntry = {
  type: "game-preview",
  data: {
    title: "Minnesota in Mexico City",
    storylines: ["A neutral-site night game."],
    keys: ["Start fast."],
    prediction: { winner: "SF", score: { sf: 24, opponent: 17 } },
    sources: [{ url: "https://www.49ers.com/news/injury-report-wednesday-week-13", outlet: "49ers.com" }],
  },
  body: "The 49ers head south.",
};

const highlights: DraftEntry = {
  type: "highlights",
  data: {
    title: "Purdy and Kittle carve up Minnesota",
    standouts: [
      { player: "Brock Purdy", team: "SF", writeUp: "Three touchdowns on 26 throws." },
      { player: "George Kittle", team: "SF", writeUp: "Two scores, both in the red zone." },
    ],
    stats: [
      { player: "Brock Purdy", team: "SF", stat: "passing_yards", scope: { type: "game", gameId: GAME }, value: 255, label: "Passing yards" },
      { player: "Brock Purdy", team: "SF", stat: "passing_tds", scope: { type: "game", gameId: GAME }, value: 3, label: "Passing TDs" },
      { player: "George Kittle", team: "SF", stat: "receiving_tds", scope: { type: "game", gameId: GAME }, value: 2, label: "Receiving TDs" },
    ],
    clips: [{ videoId: "Id7LlG3tijo", title: "Mic’d Up: Warner and Kittle Take Over Mexico City", channel: "San Francisco 49ers" }],
  },
  body: "A clinical night in Mexico City.",
};

const seasonStats: DraftEntry = {
  type: "season-stats",
  data: {
    stats: [
      { player: "Brock Purdy", team: "SF", stat: "passing_yards", scope: { type: "season", season: 2026 }, value: 2624, label: "Passing yards" },
      { team: "SF", stat: "rushing_yards", scope: { type: "season", season: 2026 }, value: 1386, label: "Rushing yards" },
    ],
  },
  body: "Nine wins in ten, and the offense keeps humming.",
};

describe("built site (post-game content)", () => {
  let contentDir: string;
  let site: BuiltSite;

  beforeAll(async () => {
    contentDir = await mkdtemp(path.join(tmpdir(), "gold-blooded-post-game-"));
    const runs: [Parameters<typeof runJob>[0]["job"], string, DraftEntry[]][] = [
      ["thursday-preview", "2026-11-19", [preview, sfStatBreakdown]],
      ["post-game", "2026-11-23", [highlights, seasonStats]],
    ];
    for (const [job, date, drafts] of runs) {
      const result = await runJob({ job, date, sources: fakeSources(snapshot), writer: fakeWriter(drafts), contentDir });
      expect(result.status).toBe("published");
    }
    site = await buildSite(contentDir);
  }, 120_000);

  afterAll(async () => {
    await site?.cleanup();
    if (contentDir) await rm(contentDir, { recursive: true, force: true });
  });

  it("shows the Highlights on the Game Week Page of the game just played, with the final score", async () => {
    const html = await site.html("/gold-blooded/game-weeks/2026-week-11/");
    const section = html.match(/<article[^>]*class="highlights"[^>]*>([\s\S]*?)<\/article>/)?.[1] ?? "";

    expect(text(section)).toContain("Highlights: Purdy and Kittle carve up Minnesota");
    expect(text(section)).toContain("Final: 49ers 35, MIN 10");
    expect(text(section)).toContain("A clinical night in Mexico City.");
    expect(html.indexOf('class="game-preview"')).toBeLessThan(html.indexOf('class="highlights"'));
  });

  it("names each standout with his stat line and write-up", async () => {
    const section = text((await site.html("/gold-blooded/game-weeks/2026-week-11/")).match(/class="highlights"[\s\S]*?<\/article>/)?.[0] ?? "");

    expect(section).toContain("Brock Purdy (SF) 255 passing yards, 3 passing TDs Three touchdowns on 26 throws.");
    expect(section).toContain("George Kittle (SF) 2 receiving TDs Two scores, both in the red zone.");
  });

  it("embeds the official YouTube clip, privacy-enhanced", async () => {
    const html = await site.html("/gold-blooded/game-weeks/2026-week-11/");

    expect(html).toContain('src="https://www.youtube-nocookie.com/embed/Id7LlG3tijo"');
    expect(html).toContain('title="Mic’d Up: Warner and Kittle Take Over Mexico City (San Francisco 49ers)"');
  });

  it("shows the Season Stats page with the record, the game it runs through, and the stats", async () => {
    const page = text(await site.html("/gold-blooded/season-stats/"));

    expect(page).not.toContain("Coming soon");
    expect(page).toContain("2026 Season Stats");
    expect(page).toContain("Record: 9-1");
    expect(page).toContain("Through 2026 Week 11, vs MIN (neutral site), won 35-10");
    expect(page).toContain("Nine wins in ten, and the offense keeps humming.");
    expect(page).toContain("Brock Purdy Passing yards 2,624");
    expect(page).toContain("49ers Rushing yards 1,386");
  });
});

describe("built site (Season Stats before any game)", () => {
  let site: BuiltSite;
  beforeAll(async () => {
    site = await buildSite("empty");
  }, 120_000);
  afterAll(async () => site?.cleanup());

  it("still has a Season Stats page, saying there are no numbers yet", async () => {
    const page = text(await site.html("/gold-blooded/season-stats/"));
    expect(page).toContain("No Season Stats yet");
    expect(page).not.toContain("Coming soon");
  });
});

function text(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .replace(/ ([,.])/g, "$1")
    .trim();
}
