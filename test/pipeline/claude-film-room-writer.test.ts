// The Claude Film Room writer's pure parts: the brief it sends, and turning its structured output
// into drafts the pipeline accepts. Nothing here calls Claude.
import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { publish, type SourceDocument, type SourceSnapshot } from "../../src/pipeline";
import { claudeFilmRoomWriter, renderFilmRoomBrief, toFilmRoomDrafts, type FilmRoomOutput } from "../../src/pipeline/adapters/real/claude-film-room-writer";
import { fakeSources } from "../support/fakes";

const VIDEO = "https://www.youtube.com/watch?v=qbPurdy0001";
const video: SourceDocument = {
  url: VIDEO,
  outlet: "The QB School",
  title: "Brock Purdy vs the Vikings Week 11, 2026 Analysis",
  publishedAt: "2026-11-24T17:00:00.000Z",
  text: "Breaking down Brock Purdy's three touchdowns.",
  film: { show: "The QB School", medium: "video", description: "Breaking down Brock Purdy's three touchdowns.", transcribed: false },
};
const snapshot: SourceSnapshot = { date: "2026-11-25", documents: [video] };
const job = { type: "film-room" as const, date: "2026-11-25", contentTypes: ["film-room" as const] };

const output: FilmRoomOutput = {
  entries: [{ link: VIDEO, title: "Purdy in Mexico City", body: "The QB School breaks down Purdy's touchdowns.", purdy: true, quotes: [] }],
};

describe("Claude Film Room writer", () => {
  it("briefs Claude on each breakdown, saying when only the title and description are available", () => {
    const brief = renderFilmRoomBrief(job, snapshot);

    expect(brief).toContain(`url: ${VIDEO}`);
    expect(brief).toContain("show: The QB School (video)");
    expect(brief).toContain("text: title and description only (no transcript could be had)");
    expect(brief).toContain("Breaking down Brock Purdy's three touchdowns.");
  });

  it("turns Claude's output into drafts the pipeline publishes", async () => {
    const drafts = toFilmRoomDrafts(output);

    expect(drafts).toEqual([{ type: "film-room", data: { link: VIDEO, title: "Purdy in Mexico City", purdy: true }, body: "The QB School breaks down Purdy's touchdowns." }]);
    const result = await publish({ job: "film-room", date: "2026-11-25", sources: fakeSources(snapshot), writer: { write: async () => drafts } });
    expect(result.status, JSON.stringify(result)).toBe("published");
  });

  it("doesn't ask Claude when there are no new breakdowns", async () => {
    const client = { beta: { messages: { parse: () => Promise.reject(new Error("Claude was asked")) } } } as unknown as Anthropic;

    expect(await claudeFilmRoomWriter({ client, log: () => {} }).write(job, { date: "2026-11-25", documents: [] })).toEqual([]);
  });
});
