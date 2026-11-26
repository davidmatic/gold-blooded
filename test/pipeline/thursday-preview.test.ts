// The Thursday preview job, and the calendar resolution it relies on, through the publish
// pipeline (Seam 1). The recorded snapshot carries the 49ers' real 2025 and 2026 nflverse
// schedule: a Week 8 bye in 2026, a Week 14 bye in 2025, and 2025 Wild Card and Divisional games.
import { describe, expect, it } from "vitest";
import { publish, type ContentWriter, type DraftEntry, type Job } from "../../src/pipeline";
import { fakeSources, recordedSnapshot } from "../support/fakes";

const snapshot = recordedSnapshot("thursday-preview-2026-11-26");
const INJURY_URL = "https://www.49ers.com/news/injury-report-wednesday-week-13";

const previewDraft: DraftEntry = {
  type: "game-preview",
  data: {
    title: "Seattle comes to Santa Clara with the West on the line",
    storylines: ["The NFC West lead is at stake.", "Fred Warner's ankle."],
    keys: ["Win on early downs.", "Keep the pass rush fresh."],
    prediction: { winner: "SF", score: { sf: 27, opponent: 20 } },
    sources: [{ url: INJURY_URL, outlet: "49ers.com" }],
    injuries: [{ player: "Fred Warner", practiceStatus: "DNP" }],
  },
  body: "Seattle visits Levi's Stadium on Sunday.",
};

const recapDraft: DraftEntry = {
  type: "season-recap",
  data: {
    title: "Halfway home",
    sources: [{ url: INJURY_URL, outlet: "49ers.com" }],
  },
  body: "The 49ers head into the bye at 5-2.",
};

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

function runThursday(date: string, writer = recordingWriter([previewDraft, recapDraft]), sources = fakeSources(snapshot)) {
  return publish({ job: "thursday-preview", date, sources, writer });
}

describe("Thursday preview job: a regular-season Game Week", () => {
  it("writes the Game Preview onto the upcoming game's Game Week Page", async () => {
    const result = await runThursday("2026-11-26");

    expect(result).toEqual({
      status: "published",
      entries: [
        {
          type: "game-preview",
          path: "game-weeks/2026-week-12/preview.md",
          data: {
            ...previewDraft.data,
            date: "2026-11-26",
            gameWeek: "2026-week-12",
            gameId: "2026_12_SEA_SF",
            season: 2026,
            week: 12,
            gameType: "REG",
            opponent: "SEA",
            venue: "home",
            kickoff: "2026-11-29T21:25:00.000Z",
          },
          body: previewDraft.body,
        },
      ],
    });
  });
});

describe("Thursday preview job: a Bye Week", () => {
  it("writes a season recap, with the record and the next game, instead of a Game Preview", async () => {
    // 2026 Week 8: the 49ers are 6-1 after losing at Atlanta in Week 7; Las Vegas visits in Week 9.
    const result = await runThursday("2026-10-29");

    expect(result).toEqual({
      status: "published",
      entries: [
        {
          type: "season-recap",
          path: "game-weeks/2026-week-08/season-recap.md",
          data: {
            ...recapDraft.data,
            date: "2026-10-29",
            gameWeek: "2026-week-08",
            season: 2026,
            week: 8,
            record: { wins: 6, losses: 1, ties: 0 },
            nextGame: { gameWeek: "2026-week-09", opponent: "LV", venue: "home", kickoff: "2026-11-08T21:25:00.000Z" },
          },
          body: recapDraft.body,
        },
      ],
    });
  });
});

describe("Thursday preview job: the playoffs", () => {
  it("gives the Wild Card game its own Game Week Page", async () => {
    const writer = recordingWriter([{ ...previewDraft, data: { ...previewDraft.data, prediction: { winner: "PHI", score: { sf: 20, opponent: 24 } } } }]);
    const result = await runThursday("2026-01-08", writer);

    expect(result.status).toBe("published");
    if (result.status !== "published") return;
    expect(result.entries.map((entry) => entry.path)).toEqual(["game-weeks/2025-wild-card/preview.md"]);
    expect(result.entries[0]!.data).toMatchObject({
      gameWeek: "2025-wild-card",
      gameId: "2025_19_SF_PHI",
      season: 2025,
      week: 19,
      gameType: "WC",
      opponent: "PHI",
      venue: "away",
      kickoff: "2026-01-11T21:30:00.000Z",
    });
    expect(writer.jobs[0]!.calendar).toMatchObject({
      period: "game-week",
      upcoming: { gameId: "2025_19_SF_PHI" },
      previous: { gameId: "2025_18_SEA_SF" },
    });
  });

  it("gives the next playoff game its own Game Week, with the Wild Card game as the previous game", async () => {
    const writer = recordingWriter([{ ...previewDraft, data: { ...previewDraft.data, prediction: { winner: "SF", score: { sf: 24, opponent: 23 } } } }]);
    const result = await runThursday("2026-01-15", writer);

    expect(result.status).toBe("published");
    if (result.status !== "published") return;
    expect(result.entries.map((entry) => entry.path)).toEqual(["game-weeks/2025-divisional/preview.md"]);
    expect(writer.jobs[0]!.calendar).toMatchObject({
      period: "game-week",
      gameWeek: "2025-divisional",
      upcoming: { gameId: "2025_20_SF_SEA" },
      previous: { gameId: "2025_19_SF_PHI" },
    });
  });
});

describe("Thursday preview job: the Offseason", () => {
  it.each([
    ["the preseason (nflverse lists no preseason games)", "2026-08-20"],
    ["the spring, after the 2025 season ended in the Divisional round", "2026-03-12"],
    ["the day before the season's first Game Week", "2026-09-03"],
  ])("publishes nothing in %s, without asking the writer", async (_, date) => {
    const writer = recordingWriter([previewDraft, recapDraft]);
    const result = await runThursday(date, writer);

    expect(result).toEqual({ status: "published", entries: [] });
    expect(writer.jobs).toEqual([]);
  });
});

describe("calendar resolution at the edges of a Game Week", () => {
  async function calendarOn(date: string) {
    const writer = recordingWriter([]);
    await runThursday(date, writer);
    return writer.jobs[0]?.calendar;
  }

  it("starts the season's first Game Week six days before kickoff, with no previous game", async () => {
    const calendar = await calendarOn("2026-09-04");
    expect(calendar).toMatchObject({ period: "game-week", gameWeek: "2026-week-01", upcoming: { gameId: "2026_01_SF_LA" } });
    expect(calendar).not.toHaveProperty("previous");
  });

  it("runs a Game Week through game day, and starts the next one the day after", async () => {
    expect(await calendarOn("2026-11-29")).toMatchObject({ period: "game-week", gameWeek: "2026-week-12" });
    expect(await calendarOn("2026-11-30")).toMatchObject({
      period: "game-week",
      gameWeek: "2026-week-13",
      upcoming: { gameId: "2026_13_SF_NYG" },
      previous: { gameId: "2026_12_SEA_SF" },
    });
  });

  it("ends a Bye Week seven days before the next game, where that game's Game Week begins", async () => {
    expect(await calendarOn("2026-11-01")).toMatchObject({ period: "bye-week", week: 8, previous: { gameId: "2026_07_SF_ATL" } });
    expect(await calendarOn("2026-11-02")).toMatchObject({
      period: "game-week",
      gameWeek: "2026-week-09",
      previous: { gameId: "2026_07_SF_ATL" },
    });
  });

  it("finds the 2025 Week 14 bye", async () => {
    expect(await calendarOn("2025-12-04")).toMatchObject({ period: "bye-week", gameWeek: "2025-week-14", season: 2025, week: 14 });
  });
});

describe("Thursday preview job: rejected runs", () => {
  it("rejects a prediction whose winner isn't one of the two teams", async () => {
    const draft = { ...previewDraft, data: { ...previewDraft.data, prediction: { winner: "DAL", score: { sf: 27, opponent: 20 } } } };
    const result = await runThursday("2026-11-26", recordingWriter([draft]));

    expect(result).toEqual({
      status: "rejected",
      failures: [{ check: "schema", entry: "game-weeks/2026-week-12/preview.md", reason: "prediction.winner: the winner must be SF or SEA" }],
    });
  });

  it("rejects a prediction whose winner doesn't have the higher score", async () => {
    const draft = { ...previewDraft, data: { ...previewDraft.data, prediction: { winner: "SF", score: { sf: 17, opponent: 20 } } } };
    const result = await runThursday("2026-11-26", recordingWriter([draft]));

    expect(result.status).toBe("rejected");
    if (result.status !== "rejected") return;
    expect(result.failures[0]!.reason).toMatch(/^prediction.score: /);
  });

  it("checks a Game Preview's injury statuses against the official report", async () => {
    const draft = { ...previewDraft, data: { ...previewDraft.data, injuries: [{ player: "C.J. West", gameStatus: "Out" }] } };
    const result = await runThursday("2026-11-26", recordingWriter([draft]));

    expect(result).toEqual({
      status: "rejected",
      failures: [
        {
          check: "injury-status",
          entry: "game-weeks/2026-week-12/preview.md",
          reason: "C.J. West: draft says game status Out, official injury report says Questionable",
        },
      ],
    });
  });

  it("checks that a Game Preview's sources load", async () => {
    const result = await runThursday("2026-11-26", undefined, fakeSources(snapshot, { deadLinks: [INJURY_URL] }));

    expect(result).toEqual({
      status: "rejected",
      failures: [{ check: "source-links", entry: "game-weeks/2026-week-12/preview.md", reason: `source link does not load: ${INJURY_URL}` }],
    });
  });

  it("rejects a Game Week run that comes back without a Game Preview", async () => {
    const result = await runThursday("2026-11-26", recordingWriter([]));

    expect(result).toEqual({
      status: "rejected",
      failures: [{ check: "schema", entry: "game-preview", reason: "the thursday-preview job writes exactly one game-preview, and the writer returned 0" }],
    });
  });

  it("rejects a Game Preview written in a Bye Week", async () => {
    const result = await runThursday("2026-10-29", { write: async () => [previewDraft, recapDraft] });

    expect(result).toEqual({
      status: "rejected",
      failures: [{ check: "schema", entry: "game-preview", reason: "the thursday-preview job doesn't write a game-preview on 2026-10-29" }],
    });
  });
});
