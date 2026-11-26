// Seam 2 for Offseason mode: the homepage's Game Preview slot and the Offseason pages. Each
// content folder is written by the publish pipeline (the Thursday preview and Offseason jobs,
// with fake adapters), so these tests also prove the site reads what the pipeline writes.
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runJob, type DraftEntry, type JobType } from "../src/pipeline";
import { buildSite, type BuiltSite } from "./support/built-site";
import { fakeSources, fakeWriter, recordedSnapshot } from "./support/fakes";

const previewSnapshot = recordedSnapshot("thursday-preview-2026-11-26");
const offseasonSnapshot = recordedSnapshot("offseason-2026");
const INJURY = { url: "https://www.49ers.com/news/injury-report-wednesday-week-13", outlet: "49ers.com" };
const HALE = { url: "https://www.49ers.com/news/49ers-sign-cb-marcus-hale", outlet: "49ers.com" };
const MOCK = { url: "https://www.espn.com/nfl/draft2026/story/_/id/1/mock-draft-3-0", outlet: "ESPN" };

function preview(title: string): DraftEntry {
  return {
    type: "game-preview",
    data: { title, storylines: ["A storyline."], keys: ["A key."], prediction: { winner: "SF", score: { sf: 24, opponent: 20 } }, sources: [INJURY] },
    body: `${title}, in full.`,
  };
}

const offseasonUpdate: DraftEntry[] = [
  {
    type: "free-agency-tracker",
    data: { moves: [{ player: "Marcus Hale", position: "CB", kind: "signing", date: "2026-03-11", detail: "Three years.", source: HALE }], sources: [] },
    body: "Free agency opened with a corner.",
  },
  {
    type: "draft-coverage",
    data: {
      teamNeeds: [{ position: "OT", note: "A long-term answer at tackle." }],
      mockDrafts: [{ player: "Devin Archer", position: "OT", school: "Ohio State", pick: 27, source: MOCK }],
      picks: [],
      profiles: [],
      sources: [MOCK],
    },
    body: "The 49ers pick 27th.",
  },
];

type Run = [JobType, string, DraftEntry[]];

/** Runs the jobs into a fresh content folder, in order, and builds the site from it. */
async function siteAfter(runs: Run[]): Promise<{ site: BuiltSite; contentDir: string }> {
  const contentDir = await mkdtemp(path.join(tmpdir(), "gold-blooded-offseason-site-"));
  for (const [job, date, drafts] of runs) {
    const snapshot = job === "offseason" ? offseasonSnapshot : previewSnapshot;
    const result = await runJob({ job, date, sources: fakeSources(snapshot), writer: fakeWriter(drafts), contentDir });
    expect(result.status, `${job} on ${date}`).toBe("published");
  }
  return { site: await buildSite(contentDir), contentDir };
}

const lastPlayoffPreview: Run = ["thursday-preview", "2026-01-15", [preview("Divisional round in Seattle")]];

function useSite(runs: Run[]) {
  const built: { site?: BuiltSite; contentDir?: string } = {};
  beforeAll(async () => Object.assign(built, await siteAfter(runs)), 120_000);
  afterAll(async () => {
    await built.site?.cleanup();
    if (built.contentDir) await rm(built.contentDir, { recursive: true, force: true });
  });
  return () => built.site!;
}

describe("built site in the Offseason, during free agency", () => {
  const site = useSite([lastPlayoffPreview, ["offseason", "2026-03-12", offseasonUpdate]]);

  it("swaps the homepage's Game Preview slot for the Free Agency Tracker", async () => {
    const html = await site().html("/gold-blooded/");
    const lead = section(html, "offseason-lead");

    expect(text(lead)).toContain("2026 Free Agency Tracker");
    expect(text(lead)).toContain("Marcus Hale");
    expect(lead).toContain('href="/gold-blooded/free-agency-tracker/"');
    expect(section(html, "game-preview-lead")).toBe("");
    expect(text(html)).not.toContain("Divisional round in Seattle");
  });

  it("has a Free Agency Tracker page listing the moves, each linked to its source", async () => {
    const html = await site().html("/gold-blooded/free-agency-tracker/");

    expect(text(html)).toContain("Free agency opened with a corner.");
    expect(text(html)).toMatch(/Signing\s+Marcus Hale\s*,\s*CB\s*:\s*Three years/);
    expect(html).toContain(`href="${HALE.url}"`);
  });

  it("has a Draft Coverage page with the team needs and the mock draft roundup", async () => {
    const html = await site().html("/gold-blooded/draft-coverage/");

    expect(text(html)).toContain("A long-term answer at tackle.");
    expect(text(html)).toContain("Devin Archer");
    expect(html).toContain(`href="${MOCK.url}"`);
  });
});

describe("built site in the Offseason, around the draft", () => {
  // Three weeks before the 2026 NFL Draft (April 23 to 25).
  const site = useSite([lastPlayoffPreview, ["offseason", "2026-03-12", offseasonUpdate], ["offseason", "2026-04-02", offseasonUpdate]]);

  it("swaps the homepage's Game Preview slot for Draft Coverage", async () => {
    const lead = section(await site().html("/gold-blooded/"), "offseason-lead");

    expect(text(lead)).toContain("2026 Draft Coverage");
    expect(text(lead)).toContain("April 23");
    expect(lead).toContain('href="/gold-blooded/draft-coverage/"');
    expect(lead).toContain('href="/gold-blooded/free-agency-tracker/"');
  });
});

describe("built site once the season's first Game Preview is out", () => {
  const site = useSite([["offseason", "2026-09-03", offseasonUpdate], ["thursday-preview", "2026-09-10", [preview("Opening night in Los Angeles")]]]);

  it("leads with the Game Preview again", async () => {
    const html = await site().html("/gold-blooded/");

    expect(text(section(html, "game-preview-lead"))).toContain("Opening night in Los Angeles");
    expect(section(html, "offseason-lead")).toBe("");
  });
});

function section(html: string, className: string): string {
  return html.match(new RegExp(`<section[^>]*class="${className}"[^>]*>([\\s\\S]*?)</section>`))?.[1] ?? "";
}

function text(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");
}
