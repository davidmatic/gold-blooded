import { describe, expect, it } from "vitest";
import { publish, type DraftEntry } from "../../src/pipeline";
import { fakeSources, fakeWriter, recordedSnapshot } from "../support/fakes";

const DATE = "2026-11-25";
const snapshot = recordedSnapshot("daily-news-2026-11-25");
const INJURY_URL = "https://www.49ers.com/news/injury-report-wednesday-week-13";
const SHANAHAN_URL = "https://www.49ers.com/news/shanahan-press-conference-wednesday";
const INJURY_PATH = "news/2026-11-25-warner-sits-out-wednesday-practice.md";
const COACH_PATH = "news/2026-11-25-shanahan-wants-more-on-third-down.md";

function injuryDraft(injuries: unknown[]): DraftEntry {
  return {
    type: "news-summary",
    data: {
      title: "Warner sits out Wednesday practice",
      category: "Injury",
      sources: [{ url: INJURY_URL, outlet: "49ers.com" }],
      injuries,
    },
    body: "Fred Warner did not practice on Wednesday with an ankle injury.",
  };
}

function coachDraft(quotes: unknown[]): DraftEntry {
  return {
    type: "news-summary",
    data: {
      title: "Shanahan wants more on third down",
      category: "Coach's Comments",
      sources: [{ url: SHANAHAN_URL, outlet: "49ers.com" }],
      quotes,
    },
    body: "Kyle Shanahan put the third-down struggles on everyone, himself included.",
  };
}

function run(drafts: DraftEntry[], sources = fakeSources(snapshot)) {
  return publish({ job: "daily-news", date: DATE, sources, writer: fakeWriter(drafts) });
}

describe("injury status publish check", () => {
  it("publishes a summary whose stated statuses match the official report", async () => {
    const injuries = [
      { player: "Fred Warner", practiceStatus: "DNP" },
      { player: "CJ West Jr.", practiceStatus: "FP", gameStatus: "Questionable" },
    ];
    const result = await run([injuryDraft(injuries)]);

    expect(result.status).toBe("published");
    if (result.status !== "published") return;
    expect(result.entries[0]).toMatchObject({ type: "news-summary", data: { injuries } });
  });

  it("rejects a game status the official report doesn't give", async () => {
    const result = await run([injuryDraft([{ player: "Fred Warner", gameStatus: "Out" }])]);

    expect(result).toEqual({
      status: "rejected",
      failures: [
        {
          check: "injury-status",
          entry: INJURY_PATH,
          reason: "Fred Warner: draft says game status Out, official injury report says none",
        },
      ],
    });
  });

  it("rejects a status for a player who isn't on the official report", async () => {
    const result = await run([injuryDraft([{ player: "Brock Purdy", gameStatus: "Out" }])]);

    expect(result).toEqual({
      status: "rejected",
      failures: [{ check: "injury-status", entry: INJURY_PATH, reason: "Brock Purdy: not on the official injury report" }],
    });
  });

  it("rejects stated statuses when the snapshot has no official report to check them against", async () => {
    const { injuryReport: _, ...withoutReport } = snapshot;
    const result = await run([injuryDraft([{ player: "Fred Warner", practiceStatus: "DNP" }])], fakeSources(withoutReport));

    expect(result).toEqual({
      status: "rejected",
      failures: [
        { check: "injury-status", entry: INJURY_PATH, reason: "the source snapshot has no official injury report" },
      ],
    });
  });

  it("rejects an Injury summary that states no injury statuses, since nothing could be checked", async () => {
    const result = await run([injuryDraft([])]);

    expect(result.status).toBe("rejected");
    if (result.status !== "rejected") return;
    expect(result.failures).toEqual([
      expect.objectContaining({ check: "schema", entry: INJURY_PATH, reason: expect.stringMatching(/injuries/) }),
    ]);
  });
});

describe("quote publish check", () => {
  it("publishes quotes found word for word, even across a line break or with curly apostrophes", async () => {
    const quotes = [
      { text: "That’s on all of us, starting with me.", speaker: "Kyle Shanahan", source: SHANAHAN_URL },
      { text: "We have to be better on third down.", speaker: "Kyle Shanahan", source: SHANAHAN_URL },
    ];
    const result = await run([coachDraft(quotes)]);

    expect(result.status).toBe("published");
    if (result.status !== "published") return;
    expect(result.entries[0]).toMatchObject({ type: "news-summary", data: { quotes } });
  });

  it("rejects a quote whose source isn't in the source snapshot", async () => {
    const elsewhere = "https://www.espn.com/nfl/story/shanahan-third-down";
    const draft = coachDraft([{ text: "We have to be better on third down.", speaker: "Kyle Shanahan", source: elsewhere }]);
    (draft.data.sources as unknown[]).push({ url: elsewhere, outlet: "ESPN" });
    const result = await run([draft]);

    expect(result).toEqual({
      status: "rejected",
      failures: [
        {
          check: "quotes",
          entry: COACH_PATH,
          reason: `quote from Kyle Shanahan not found word for word in ${elsewhere}: "We have to be better on third down."`,
        },
      ],
    });
  });

  it("rejects a quote attributed to a source the summary doesn't link to", async () => {
    const result = await run([
      coachDraft([{ text: "Did not participate", speaker: "49ers", source: INJURY_URL }]),
    ]);

    expect(result.status).toBe("rejected");
    if (result.status !== "rejected") return;
    expect(result.failures).toEqual([
      expect.objectContaining({ check: "schema", entry: COACH_PATH, reason: expect.stringMatching(/quotes\.0\.source/) }),
    ]);
  });

  it("rejects the run when a quote isn't word for word in its source", async () => {
    const result = await run([
      coachDraft([{ text: "We need to be better on third down.", speaker: "Kyle Shanahan", source: SHANAHAN_URL }]),
    ]);

    expect(result).toEqual({
      status: "rejected",
      failures: [
        {
          check: "quotes",
          entry: COACH_PATH,
          reason: `quote from Kyle Shanahan not found word for word in ${SHANAHAN_URL}: "We need to be better on third down."`,
        },
      ],
    });
  });

  it("rejects the run when a stated practice status differs from the official report", async () => {
    const result = await run([
      injuryDraft([
        { player: "Fred Warner", practiceStatus: "DNP" },
        { player: "Brandon Aiyuk", practiceStatus: "DNP" },
      ]),
    ]);

    expect(result).toEqual({
      status: "rejected",
      failures: [
        {
          check: "injury-status",
          entry: INJURY_PATH,
          reason: "Brandon Aiyuk: draft says practice status DNP, official injury report says LP",
        },
      ],
    });
  });
});
