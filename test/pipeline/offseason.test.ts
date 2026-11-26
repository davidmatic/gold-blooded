// The Offseason job through the publish pipeline (Seam 1). The recorded snapshot carries the
// 49ers' real 2025 and 2026 nflverse schedule (the 2025 season ended in the Divisional round on
// 2026-01-17; 2026 Week 1 is 2026-09-10) and a few made-up Offseason documents.
import { describe, expect, it } from "vitest";
import { publish, type ContentWriter, type DraftEntry, type Job, type SourceSnapshot } from "../../src/pipeline";
import { fakeSources, recordedSnapshot } from "../support/fakes";

const snapshot = recordedSnapshot("offseason-2026");
const HALE = { url: "https://www.49ers.com/news/49ers-sign-cb-marcus-hale", outlet: "49ers.com" };
const PIKE = { url: "https://www.49ers.com/news/49ers-re-sign-lb-owen-pike", outlet: "49ers.com" };
const VANCE = { url: "https://www.nbcsportsbayarea.com/nfl/san-francisco-49ers/tyrell-vance-bears", outlet: "NBC Sports Bay Area" };
const MOCK = { url: "https://www.espn.com/nfl/draft2026/story/_/id/1/mock-draft-3-0", outlet: "ESPN" };
const PICK = { url: "https://www.49ers.com/news/49ers-select-devin-archer", outlet: "49ers.com" };

const haleSigning = { player: "Marcus Hale", position: "CB", kind: "signing", date: "2026-03-11", detail: "Three years, from Tennessee.", source: HALE };
const vanceDeparture = { player: "Tyrell Vance", position: "DT", kind: "departure", date: "2026-03-11", detail: "Signed with Chicago.", source: VANCE };
const pikeResigning = { player: "Owen Pike", position: "LB", kind: "re-signing", date: "2026-03-11", detail: "One year.", source: PIKE };

function trackerDraft(moves: object[], sources: object[] = []): DraftEntry {
  return { type: "free-agency-tracker", data: { moves, sources }, body: "Free agency opened with a splash." };
}

function coverageDraft(data: Record<string, unknown> = {}): DraftEntry {
  return {
    type: "draft-coverage",
    data: { teamNeeds: [], mockDrafts: [], picks: [], profiles: [], sources: [MOCK], ...data },
    body: "The 49ers pick 27th.",
  };
}

/** A writer that returns the drafts of the types the job asks for, and remembers the job. */
function recordingWriter(drafts: DraftEntry[]): ContentWriter & { jobs: Job[] } {
  const jobs: Job[] = [];
  return {
    jobs,
    write: async (job) => {
      jobs.push(job);
      return drafts.filter((draft) => job.contentTypes?.includes(draft.type));
    },
  };
}

function runOffseason(date: string, drafts: DraftEntry[], source: SourceSnapshot = snapshot) {
  const writer = recordingWriter(drafts);
  return { writer, result: publish({ job: "offseason", date, sources: fakeSources(source), writer }) };
}

describe("Offseason job: the first update of an Offseason", () => {
  it("starts the year's Free Agency Tracker and Draft Coverage", async () => {
    const { result } = runOffseason("2026-03-12", [
      trackerDraft([haleSigning, vanceDeparture]),
      coverageDraft({ teamNeeds: [{ position: "OT", note: "Trent Williams can't play forever." }] }),
    ]);

    expect(await result).toEqual({
      status: "published",
      entries: [
        {
          type: "free-agency-tracker",
          path: "offseason/2026/free-agency-tracker.md",
          data: {
            title: "2026 Free Agency Tracker",
            offseason: 2026,
            updated: "2026-03-12",
            moves: [haleSigning, vanceDeparture],
            sources: [HALE, VANCE],
          },
          body: "Free agency opened with a splash.",
        },
        {
          type: "draft-coverage",
          path: "offseason/2026/draft-coverage.md",
          data: {
            title: "2026 Draft Coverage",
            offseason: 2026,
            updated: "2026-03-12",
            draft: { start: "2026-04-23", end: "2026-04-25" },
            teamNeeds: [{ position: "OT", note: "Trent Williams can't play forever." }],
            mockDrafts: [],
            picks: [],
            profiles: [],
            sources: [MOCK],
          },
          body: "The 49ers pick 27th.",
        },
      ],
    });
  });
});

describe("Offseason job: a running update", () => {
  const before: SourceSnapshot = {
    ...snapshot,
    current: {
      "free-agency-tracker": {
        data: { title: "2026 Free Agency Tracker", offseason: 2026, updated: "2026-03-12", moves: [haleSigning, vanceDeparture], sources: [HALE, VANCE] },
        body: "Free agency opened with a splash.",
      },
      "draft-coverage": {
        data: {
          title: "2026 Draft Coverage",
          offseason: 2026,
          updated: "2026-04-16",
          draft: { start: "2026-04-23", end: "2026-04-25" },
          teamNeeds: [{ position: "OT", note: "Tackle depth." }],
          mockDrafts: [{ player: "Devin Archer", position: "OT", school: "Ohio State", pick: 27, source: MOCK }],
          picks: [],
          profiles: [],
          sources: [MOCK],
        },
        body: "The 49ers pick 27th.",
      },
    },
  } as SourceSnapshot;

  it("adds the day's moves to the Free Agency Tracker, newest first, and keeps the earlier ones", async () => {
    const correctedHale = { ...haleSigning, detail: "Three years, $30 million, from Tennessee." };
    const { result } = runOffseason("2026-03-13", [trackerDraft([pikeResigning, correctedHale]), coverageDraft()], before);
    const published = await result;

    expect(published.status).toBe("published");
    if (published.status !== "published") return;
    const tracker = published.entries.find((entry) => entry.type === "free-agency-tracker")!;
    expect(tracker.data).toMatchObject({
      updated: "2026-03-13",
      moves: [pikeResigning, correctedHale, vanceDeparture],
      // Only this update's sources: earlier links aren't rechecked.
      sources: [PIKE, HALE],
    });
  });

  it("tracks draft-day picks in draft order, keeps the team needs and mock drafts, and adds profiles", async () => {
    const archer = { player: "Devin Archer", position: "OT", school: "Ohio State", round: 1, overall: 27, source: PICK };
    const profile = { player: "Devin Archer", position: "OT", school: "Ohio State", profile: "A four-year starter at left tackle.", source: PICK };
    const { result } = runOffseason("2026-04-24", [trackerDraft([]), coverageDraft({ picks: [archer], profiles: [profile], sources: [] })], before);
    const published = await result;

    expect(published.status).toBe("published");
    if (published.status !== "published") return;
    const coverage = published.entries.find((entry) => entry.type === "draft-coverage")!;
    expect(coverage.data).toEqual({
      ...before.current!["draft-coverage"]!.data,
      updated: "2026-04-24",
      picks: [archer],
      profiles: [profile],
      sources: [PICK],
    });
  });
});

describe("Offseason job: publish checks", () => {
  it("rejects a move whose source doesn't name the player", async () => {
    const madeUp = { ...haleSigning, player: "Nobody Atall" };
    const { result } = runOffseason("2026-03-12", [trackerDraft([madeUp]), coverageDraft()]);

    expect(await result).toEqual({
      status: "rejected",
      failures: [
        {
          check: "offseason-sources",
          entry: "offseason/2026/free-agency-tracker.md",
          reason: `Nobody Atall (moves): not named in the cited source ${HALE.url}`,
        },
      ],
    });
  });

  it("rejects a draft pick whose source isn't in the source snapshot", async () => {
    const elsewhere = { url: "https://example.com/somewhere-else", outlet: "Elsewhere" };
    const pick = { player: "Devin Archer", position: "OT", school: "Ohio State", round: 1, overall: 27, source: elsewhere };
    const { result } = runOffseason("2026-04-24", [trackerDraft([]), coverageDraft({ picks: [pick] })]);

    expect(await result).toEqual({
      status: "rejected",
      failures: [
        {
          check: "offseason-sources",
          entry: "offseason/2026/draft-coverage.md",
          reason: `Devin Archer (picks): the cited source ${elsewhere.url} is not in the source snapshot`,
        },
      ],
    });
  });

  it("doesn't recheck items already in the document, whose sources are long gone from the snapshot", async () => {
    const old = { ...haleSigning, source: { url: "https://www.49ers.com/news/an-old-story", outlet: "49ers.com" } };
    const before = {
      ...snapshot,
      current: {
        "free-agency-tracker": {
          data: { title: "2026 Free Agency Tracker", offseason: 2026, updated: "2026-03-12", moves: [old], sources: [old.source] },
          body: "",
        },
      },
    } as SourceSnapshot;
    const { result } = runOffseason("2026-03-13", [trackerDraft([pikeResigning]), coverageDraft()], before);

    expect((await result).status).toBe("published");
  });

  it("rejects the run when the source link of a new move doesn't load", async () => {
    const result = await publish({
      job: "offseason",
      date: "2026-03-12",
      sources: fakeSources(snapshot, { deadLinks: [VANCE.url] }),
      writer: recordingWriter([trackerDraft([vanceDeparture]), coverageDraft()]),
    });

    expect(result).toMatchObject({ status: "rejected", failures: [{ check: "source-links", reason: `source link does not load: ${VANCE.url}` }] });
  });
});

describe("Offseason job: in the season", () => {
  it.each([
    ["a regular-season Game Week", "2026-11-26"],
    ["a Bye Week", "2026-10-29"],
    ["a playoff Game Week", "2026-01-15"],
    ["the season's first Game Week", "2026-09-04"],
  ])("writes nothing in %s, and doesn't call the writer", async (_label, date) => {
    const { writer, result } = runOffseason(date, [trackerDraft([haleSigning]), coverageDraft()]);

    expect(await result).toEqual({ status: "published", entries: [] });
    expect(writer.jobs).toEqual([]);
  });
});

describe("game content jobs in the Offseason", () => {
  it.each([
    ["free agency", "2026-03-12"],
    ["draft week", "2026-04-23"],
    ["the preseason", "2026-08-20"],
  ])("the Thursday preview job produces nothing during %s", async (_label, date) => {
    const writer = recordingWriter([]);
    const result = await publish({ job: "thursday-preview", date, sources: fakeSources(snapshot), writer });

    expect(result).toEqual({ status: "published", entries: [] });
    expect(writer.jobs).toEqual([]);
  });
});
