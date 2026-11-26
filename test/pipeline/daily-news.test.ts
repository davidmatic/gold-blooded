import { describe, expect, it } from "vitest";
import { publish, type DraftEntry } from "../../src/pipeline";
import { fakeSources, fakeWriter, recordedSnapshot } from "../support/fakes";

const DATE = "2026-11-25";
const snapshot = recordedSnapshot("daily-news-2026-11-25");
const SIGNING_URL = "https://www.nbcsportsbayarea.com/nfl/san-francisco-49ers/practice-squad-signing";

const injuryDraft: DraftEntry = {
  type: "news-summary",
  data: {
    title: "Warner sits out Wednesday practice",
    category: "Injury",
    sources: [{ url: "https://www.49ers.com/news/injury-report-wednesday-week-13", outlet: "49ers.com" }],
  },
  body: "Fred Warner did not practice on Wednesday with an ankle injury. Brandon Aiyuk was limited.",
};

const personnelDraft: DraftEntry = {
  type: "news-summary",
  data: {
    title: "A new corner joins the practice squad",
    category: "Personnel",
    sources: [{ url: SIGNING_URL, outlet: "NBC Sports Bay Area" }],
  },
  body: "San Francisco added a cornerback to its practice squad.",
};

describe("daily news job", () => {
  it("publishes the writer's News Summaries, dated and filed under news/", async () => {
    const result = await publish({
      job: "daily-news",
      date: DATE,
      sources: fakeSources(snapshot),
      writer: fakeWriter([injuryDraft, personnelDraft]),
    });

    expect(result).toEqual({
      status: "published",
      entries: [
        {
          type: "news-summary",
          path: "news/2026-11-25-warner-sits-out-wednesday-practice.md",
          data: { ...injuryDraft.data, date: DATE },
          body: injuryDraft.body,
        },
        {
          type: "news-summary",
          path: "news/2026-11-25-a-new-corner-joins-the-practice-squad.md",
          data: { ...personnelDraft.data, date: DATE },
          body: personnelDraft.body,
        },
      ],
    });
  });

  it("rejects the whole run when a News Summary's source link doesn't load", async () => {
    const result = await publish({
      job: "daily-news",
      date: DATE,
      sources: fakeSources(snapshot, { deadLinks: [SIGNING_URL] }),
      writer: fakeWriter([injuryDraft, personnelDraft]),
    });

    expect(result).toEqual({
      status: "rejected",
      failures: [
        {
          check: "source-links",
          entry: "news/2026-11-25-a-new-corner-joins-the-practice-squad.md",
          reason: `source link does not load: ${SIGNING_URL}`,
        },
      ],
    });
  });

  it("rejects a draft that doesn't fit the News Summary schema", async () => {
    const result = await publish({
      job: "daily-news",
      date: DATE,
      sources: fakeSources(snapshot),
      writer: fakeWriter([
        injuryDraft,
        { type: "news-summary", data: { title: "Rumour mill", category: "Gossip", sources: [] }, body: "Who knows." },
      ]),
    });

    expect(result.status).toBe("rejected");
    if (result.status !== "rejected") return;
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]).toMatchObject({ check: "schema", entry: "news/2026-11-25-rumour-mill.md" });
    expect(result.failures[0]!.reason).toMatch(/category/);
    expect(result.failures[0]!.reason).toMatch(/source/);
  });
});
