// The Claude Offseason writer's pure parts: the brief it sends, and turning its structured
// output into drafts the pipeline accepts. Nothing here calls Claude.
import { describe, expect, it } from "vitest";
import { publish, type Job, type SourceSnapshot } from "../../src/pipeline";
import { renderOffseasonBrief, toOffseasonDrafts, type OffseasonOutput } from "../../src/pipeline/adapters/real/claude-offseason-writer";
import { resolveCalendar } from "../../src/pipeline/calendar";
import { fakeSources, recordedSnapshot } from "../support/fakes";

const snapshot = recordedSnapshot("offseason-2026");
const HALE = { url: "https://www.49ers.com/news/49ers-sign-cb-marcus-hale", outlet: "49ers.com" };
const MOCK = { url: "https://www.espn.com/nfl/draft2026/story/_/id/1/mock-draft-3-0", outlet: "ESPN" };

const output: OffseasonOutput = {
  freeAgencyTracker: {
    body: "The 49ers added a corner.",
    newMoves: [{ player: "Marcus Hale", position: "CB", kind: "signing", date: "2026-03-11", detail: null, source: HALE }],
    sources: [],
    quotes: [],
  },
  draftCoverage: {
    body: "Tackle is the need.",
    teamNeeds: [{ position: "OT", note: "A long-term answer at tackle." }],
    newMockDrafts: [{ player: "Devin Archer", position: "OT", school: "Ohio State", pick: 27, source: MOCK }],
    newPicks: [],
    newProfiles: [],
    sources: [MOCK],
    quotes: [],
  },
};

describe("Claude Offseason writer output", () => {
  it("becomes a Free Agency Tracker and a Draft Coverage update the pipeline publishes", async () => {
    const drafts = toOffseasonDrafts(output);
    expect(drafts).toEqual([
      {
        type: "free-agency-tracker",
        data: { moves: [{ player: "Marcus Hale", position: "CB", kind: "signing", date: "2026-03-11", source: HALE }], sources: [] },
        body: "The 49ers added a corner.",
      },
      {
        type: "draft-coverage",
        data: {
          teamNeeds: output.draftCoverage.teamNeeds,
          mockDrafts: output.draftCoverage.newMockDrafts,
          picks: [],
          profiles: [],
          sources: [MOCK],
        },
        body: "Tackle is the need.",
      },
    ]);

    const result = await publish({ job: "offseason", date: "2026-03-12", sources: fakeSources(snapshot), writer: { write: async () => drafts } });
    expect(result.status).toBe("published");
  });
});

describe("Claude Offseason writer brief", () => {
  const jobOn = (date: string): Job => ({
    type: "offseason",
    date,
    contentTypes: ["free-agency-tracker", "draft-coverage"],
    calendar: resolveCalendar(date, snapshot.schedule!),
  });

  it("gives the draft's dates and where the date falls around them", () => {
    expect(renderOffseasonBrief(jobOn("2026-03-12"), snapshot)).toContain("2026 NFL Draft: 2026-04-23 to 2026-04-25 (before the draft)");
    expect(renderOffseasonBrief(jobOn("2026-04-24"), snapshot)).toContain("(during the draft)");
    expect(renderOffseasonBrief(jobOn("2026-05-10"), snapshot)).toContain("(after the draft)");
  });

  it("hands Claude the running documents as they stand, so it adds only what is new", () => {
    const withCurrent = {
      ...snapshot,
      current: {
        "free-agency-tracker": {
          data: { title: "2026 Free Agency Tracker", offseason: 2026, updated: "2026-03-12", sources: [HALE], moves: [{ player: "Marcus Hale", position: "CB", kind: "signing", date: "2026-03-11", source: HALE }] },
          body: "The 49ers added a corner.",
        },
      },
    } as SourceSnapshot;
    const brief = renderOffseasonBrief(jobOn("2026-03-13"), withCurrent);

    expect(brief).toContain('"player":"Marcus Hale"');
    expect(brief).toContain("The 49ers added a corner.");
    expect(brief).toContain("Draft Coverage as it stands: none yet");
    expect(brief).toContain(HALE.url);
  });
});
