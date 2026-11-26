// News Summaries drawn from podcast transcripts, through the publish pipeline (Seam 1).
import { describe, expect, it } from "vitest";
import { publish, type DraftEntry, type SourceSnapshot } from "../../src/pipeline";
import { fakeSources, fakeWriter, recordedSnapshot } from "../support/fakes";

const DATE = "2026-11-26";
const EPISODE = "https://podcasts.apple.com/us/podcast/brock-purdy-misses-practice-as-49ers-prepare-to-face/id1153457233?i=1000804108161";
const TRANSCRIPT =
  "Welcome to 49ers Talk. I'm Matt Maiocco, and Jennifer Lee Chan is with me. " +
  "Purdy was not on the field Wednesday. I don't think this is a long-term thing. " +
  "I'd be surprised if he doesn't play on Sunday against Seattle.";

const snapshot: SourceSnapshot = {
  ...recordedSnapshot("daily-news-2026-11-25"),
  date: DATE,
  documents: [
    ...recordedSnapshot("daily-news-2026-11-25").documents,
    {
      url: EPISODE,
      outlet: "49ers Talk",
      title: "Brock Purdy misses practice as 49ers prepare to face desperate Seahawks",
      publishedAt: "2026-11-26T02:32:18.000Z",
      text: TRANSCRIPT,
      podcast: { show: "49ers Talk", hosts: ["Matt Maiocco", "Jennifer Lee Chan"] },
    },
  ],
};

function podcastDraft(body: string, quotes: { text: string; speaker: string; source: string }[] = []): DraftEntry {
  return {
    type: "news-summary",
    data: {
      title: "Maiocco expects Purdy to play Sunday",
      category: "Practice Report",
      sources: [{ url: EPISODE, outlet: "49ers Talk" }],
      ...(quotes.length > 0 && { quotes }),
    },
    body,
  };
}

function run(drafts: DraftEntry[]) {
  return publish({ job: "daily-news", date: DATE, sources: fakeSources(snapshot), writer: fakeWriter(drafts) });
}

const PATH = "news/2026-11-26-maiocco-expects-purdy-to-play-sunday.md";

describe("podcast News Summaries", () => {
  it("publish when they credit the show and host, link to the episode, and quote the transcript word for word", async () => {
    const quote = { text: "I'd be surprised if he doesn't play on Sunday against Seattle.", speaker: "Matt Maiocco", source: EPISODE };
    const result = await run([
      podcastDraft(`On 49ers Talk, Maiocco says he doesn't see a long-term problem: "${quote.text}"`, [quote]),
    ]);

    expect(result.status).toBe("published");
    if (result.status !== "published") return;
    expect(result.entries[0]!.data.sources).toEqual([{ url: EPISODE, outlet: "49ers Talk" }]);
  });

  it("are rejected when a quote isn't word for word in the transcript", async () => {
    const quote = { text: "He'll definitely play on Sunday.", speaker: "Matt Maiocco", source: EPISODE };
    const result = await run([podcastDraft(`On 49ers Talk, Maiocco says, "${quote.text}"`, [quote])]);

    expect(result).toEqual({
      status: "rejected",
      failures: [{ check: "quotes", entry: PATH, reason: `quote from Matt Maiocco not found word for word in ${EPISODE}: "He'll definitely play on Sunday."` }],
    });
  });

  it("are rejected when they don't name the show", async () => {
    const result = await run([podcastDraft("Maiocco says he expects Purdy to play on Sunday.")]);

    expect(result).toEqual({
      status: "rejected",
      failures: [{ check: "podcast-attribution", entry: PATH, reason: `cites a 49ers Talk episode (${EPISODE}) but doesn't name the show` }],
    });
  });

  it("are rejected when they don't name a host", async () => {
    const result = await run([podcastDraft("On 49ers Talk, the hosts expect Purdy to play on Sunday.")]);

    expect(result).toEqual({
      status: "rejected",
      failures: [
        {
          check: "podcast-attribution",
          entry: PATH,
          reason: `cites a 49ers Talk episode (${EPISODE}) but doesn't name a host (Matt Maiocco, Jennifer Lee Chan)`,
        },
      ],
    });
  });

  it("accept a host named in full or by surname", async () => {
    const result = await run([podcastDraft("On 49ers Talk, Jennifer Lee Chan says Purdy should be fine for Sunday.")]);

    expect(result.status).toBe("published");
  });
});
