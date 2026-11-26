// The number grounding check, through the publish pipeline (Seam 1): every stat-like number an
// entry's prose states must be one of its cited stats or appear in a source it cites.
import { describe, expect, it } from "vitest";
import { publish, type DraftEntry, type JobType, type SourceSnapshot } from "../../src/pipeline";
import { fakeSources, purdyShrineDrafts, recordedSnapshot } from "../support/fakes";

const CONTRACT_URL = "https://www.49ers.com/news/49ers-sign-cornerback";
const news: SourceSnapshot = {
  ...recordedSnapshot("daily-news-2026-11-25"),
  documents: [
    ...recordedSnapshot("daily-news-2026-11-25").documents,
    {
      url: CONTRACT_URL,
      outlet: "49ers.com",
      title: "49ers sign cornerback",
      publishedAt: "2026-11-25T18:00:00Z",
      text: "The 49ers signed cornerback Jalen Reed to a two-year, $8.5 million deal. Reed, 26, wears No. 31.",
    },
  ],
};
const thursday = recordedSnapshot("thursday-preview-2026-11-26");

function signing(body: string, title = "49ers sign Jalen Reed"): DraftEntry {
  return { type: "news-summary", data: { title, category: "Personnel", sources: [{ url: CONTRACT_URL, outlet: "49ers.com" }] }, body };
}

function run(job: JobType, date: string, drafts: DraftEntry[], snapshot: SourceSnapshot) {
  return publish({ job, date, sources: fakeSources(snapshot), writer: { write: async (j) => drafts.filter((d) => j.contentTypes?.includes(d.type)) } });
}

describe("number grounding check", () => {
  it("publishes numbers that appear in a source the entry cites", async () => {
    const result = await run("daily-news", "2026-11-25", [signing("The 26-year-old, who wears No. 31, signed for $8.5 million.")], news);

    expect(result).toMatchObject({ status: "published" });
  });

  it("rejects a number in the body that is in none of the cited sources", async () => {
    const result = await run("daily-news", "2026-11-25", [signing("Reed signed for $9 million over two years.")], news);

    expect(result).toEqual({
      status: "rejected",
      failures: [
        {
          check: "numbers",
          entry: "news/2026-11-25-49ers-sign-jalen-reed.md",
          reason: 'states 9 ("Reed signed for $9 million over two years.") but it is none of the entry\'s cited stats and in none of the sources it cites',
        },
      ],
    });
  });

  it("checks the title too", async () => {
    const result = await run("daily-news", "2026-11-25", [signing("Reed signs.", "49ers give Reed 3 years")], news);

    expect(result.status === "rejected" && result.failures).toEqual([expect.objectContaining({ check: "numbers", reason: expect.stringMatching(/^states 3 /) })]);
  });

  it("leaves out years, dates, times, Week numbers, and the team's name", async () => {
    const body = "In 2026, the 49ers signed Reed on Nov. 25 (11/25) at 1:30 p.m., before Week 13 and Weeks 14-15.";
    const result = await run("daily-news", "2026-11-25", [signing(body)], news);

    expect(result).toMatchObject({ status: "published" });
  });

  it("publishes a Stat Breakdown whose numbers are its cited stats, at the precision they are stated", async () => {
    const breakdown: DraftEntry = {
      type: "stat-breakdown",
      data: {
        title: "Purdy's arm",
        stats: [
          { player: "Brock Purdy", team: "SF", stat: "passing_yards", scope: { type: "season", season: 2026 }, value: 2624, label: "Passing yards" },
          { team: "SF", stat: "rushing_yards", scope: { type: "last-games", season: 2026, games: 3 }, per: "game", value: 164.7, label: "Rushing yards" },
        ],
        trends: ["The run game has averaged 165 yards a game over the last three."],
      },
      body: "Purdy has 2,624 passing yards.",
    };
    const preview = gamePreview({});
    const result = await run("thursday-preview", "2026-11-26", [preview, breakdown], thursday);

    expect(result).toMatchObject({ status: "published" });
  });

  it("rejects a number in a Stat Breakdown's trends that no cited stat gives", async () => {
    const breakdown: DraftEntry = {
      type: "stat-breakdown",
      data: {
        title: "Purdy's arm",
        stats: [{ player: "Brock Purdy", team: "SF", stat: "passing_yards", scope: { type: "season", season: 2026 }, value: 2624, label: "Passing yards" }],
        trends: ["Purdy is on pace for 4,500 yards."],
      },
      body: "Purdy has 2,624 passing yards.",
    };
    const result = await run("thursday-preview", "2026-11-26", [gamePreview({}), breakdown], thursday);

    expect(result.status === "rejected" && result.failures).toEqual([
      expect.objectContaining({ check: "numbers", entry: "game-weeks/2026-week-12/stat-breakdown.md", reason: expect.stringMatching(/^states 4,500 /) }),
    ]);
  });

  it("lets a Game Preview state its predicted score and earlier results, and rejects an unsourced number in its keys", async () => {
    // The 49ers beat Minnesota 35-10 in Week 11 (on the schedule); the prediction is 27-20.
    const grounded = gamePreview({ body: "After the 35-10 win over Minnesota, we like the 49ers 27-20, at 9-1." });
    expect(await run("thursday-preview", "2026-11-26", [grounded, sfBreakdown], thursday)).toMatchObject({ status: "published" });

    const ungrounded = gamePreview({ keys: ["Hold Seattle under 100 rushing yards."] });
    const result = await run("thursday-preview", "2026-11-26", [ungrounded, sfBreakdown], thursday);
    expect(result.status === "rejected" && result.failures).toEqual([
      expect.objectContaining({ check: "numbers", entry: "game-weeks/2026-week-12/preview.md", reason: expect.stringMatching(/^states 100 /) }),
    ]);
  });

  it("lets Highlights and a Love Letter state the final score the pipeline fills in", async () => {
    const post = { ...thursday, videos: [] };
    const highlights: DraftEntry = {
      type: "highlights",
      data: {
        title: "35-10 in Mexico City",
        standouts: [{ player: "Brock Purdy", team: "SF", writeUp: "255 yards and 3 touchdowns." }],
        stats: [
          { player: "Brock Purdy", team: "SF", stat: "passing_yards", scope: { type: "game", gameId: "2026_11_MIN_SF" }, value: 255, label: "Passing yards" },
          { player: "Brock Purdy", team: "SF", stat: "passing_tds", scope: { type: "game", gameId: "2026_11_MIN_SF" }, value: 3, label: "Passing TDs" },
        ],
      },
      body: "The 49ers scored 35 and held Minnesota to 10.",
    };
    const seasonStats: DraftEntry = {
      type: "season-stats",
      data: { stats: [{ team: "SF", stat: "rushing_yards", scope: { type: "season", season: 2026 }, value: 1386, label: "Rushing yards" }] },
      body: "Nine wins in ten: 9-1.",
    };
    const [letter, reason] = purdyShrineDrafts;
    const loveLetter = { ...letter!, body: "Dear Brock, 35 points! And 7 sacks, apparently." };
    const result = await run("post-game", "2026-11-23", [highlights, seasonStats, loveLetter, reason!], post);

    expect(result.status === "rejected" && result.failures).toEqual([
      expect.objectContaining({ check: "numbers", entry: "purdy-shrine/love-letters/2026-week-11.md", reason: expect.stringMatching(/^states 7 /) }),
    ]);
  });
});

const sfBreakdown: DraftEntry = {
  type: "stat-breakdown",
  data: {
    title: "The 49ers in numbers",
    stats: [{ player: "Brock Purdy", team: "SF", stat: "passing_yards", scope: { type: "season", season: 2026 }, value: 2624, label: "Passing yards" }],
    trends: ["Purdy is on pace for a career year."],
  },
  body: "The numbers.",
};

function gamePreview(overrides: { body?: string; keys?: string[] }): DraftEntry {
  return {
    type: "game-preview",
    data: {
      title: "Seattle comes to Santa Clara",
      storylines: ["The NFC West lead is at stake."],
      keys: overrides.keys ?? ["Win on early downs."],
      prediction: { winner: "SF", score: { sf: 27, opponent: 20 } },
      sources: [{ url: "https://www.49ers.com/news/injury-report-wednesday-week-13", outlet: "49ers.com" }],
    },
    body: overrides.body ?? "Seattle visits Levi's Stadium on Sunday.",
  };
}

