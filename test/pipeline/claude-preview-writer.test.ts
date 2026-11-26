// The Claude preview writer's pure parts: the brief it sends, and turning its structured output
// into drafts the pipeline accepts. Nothing here calls Claude.
import { describe, expect, it } from "vitest";
import { publish, type Job } from "../../src/pipeline";
import {
  renderPreviewBrief,
  renderStatBreakdownBrief,
  toPreviewDraft,
  toRecapDraft,
  toStatBreakdownDraft,
  type PreviewOutput,
  type RecapOutput,
  type StatBreakdownOutput,
} from "../../src/pipeline/adapters/real/claude-preview-writer";
import { resolveCalendar } from "../../src/pipeline/calendar";
import { fakeSources, recordedSnapshot } from "../support/fakes";

const snapshot = recordedSnapshot("thursday-preview-2026-11-26");
const INJURY_URL = "https://www.49ers.com/news/injury-report-wednesday-week-13";
const SHANAHAN_URL = "https://www.49ers.com/news/shanahan-press-conference-wednesday";

const previewOutput: PreviewOutput = {
  title: "Seattle comes to Santa Clara",
  body: 'Kyle Shanahan said, "We have to be better on third down."',
  storylines: ["The NFC West lead."],
  keys: ["Third down."],
  prediction: { winner: "SF", sfScore: 24, opponentScore: 20 },
  sources: [
    { url: INJURY_URL, outlet: "49ers.com" },
    { url: SHANAHAN_URL, outlet: "49ers.com" },
  ],
  injuries: [{ player: "Fred Warner", practiceStatus: "DNP", gameStatus: null }],
  quotes: [{ text: "We have to be better on third down.", speaker: "Kyle Shanahan", source: SHANAHAN_URL }],
};

const breakdownOutput: StatBreakdownOutput = {
  title: "Purdy against Seattle's secondary",
  body: "The 49ers' passing game is humming.",
  trends: ["The run game is averaging nearly 165 yards over the last three."],
  stats: [
    {
      player: "Brock Purdy",
      team: "SF",
      stat: "passing_yards",
      scope: { type: "season", season: 2026, seasonType: null, gameId: null, games: null },
      perGame: false,
      value: 2624,
      label: "Passing yards",
    },
    {
      player: null,
      team: "SF",
      stat: "rushing_yards",
      scope: { type: "last-games", season: 2026, seasonType: null, gameId: null, games: 3 },
      perGame: true,
      value: 164.7,
      label: "Rushing yards",
    },
    {
      player: null,
      team: "SEA",
      stat: "passing_yards",
      scope: { type: "game", season: null, seasonType: null, gameId: "2026_05_SF_SEA", games: null },
      perGame: false,
      value: 195,
      label: "Passing yards",
    },
  ],
};

const recapOutput: RecapOutput = {
  title: "Six and one",
  body: "A fine first half of the season.",
  sources: [{ url: INJURY_URL, outlet: "49ers.com" }],
  injuries: [],
  quotes: [],
};

describe("Claude preview writer output", () => {
  it("becomes a Game Preview draft the pipeline publishes", async () => {
    const draft = toPreviewDraft(previewOutput);
    expect(draft).toEqual({
      type: "game-preview",
      data: {
        title: "Seattle comes to Santa Clara",
        storylines: ["The NFC West lead."],
        keys: ["Third down."],
        prediction: { winner: "SF", score: { sf: 24, opponent: 20 } },
        sources: previewOutput.sources,
        injuries: [{ player: "Fred Warner", practiceStatus: "DNP" }],
        quotes: previewOutput.quotes,
      },
      body: previewOutput.body,
    });

    const result = await publish({
      job: "thursday-preview",
      date: "2026-11-26",
      sources: fakeSources(snapshot),
      writer: { write: async () => [draft, toStatBreakdownDraft(breakdownOutput)] },
    });
    expect(result.status).toBe("published");
  });

  it("becomes a Stat Breakdown draft of cited stats, which the pipeline checks against nflverse and publishes", async () => {
    const draft = toStatBreakdownDraft(breakdownOutput);
    expect(draft).toEqual({
      type: "stat-breakdown",
      data: {
        title: "Purdy against Seattle's secondary",
        trends: breakdownOutput.trends,
        stats: [
          { player: "Brock Purdy", team: "SF", stat: "passing_yards", scope: { type: "season", season: 2026 }, value: 2624, label: "Passing yards" },
          { team: "SF", stat: "rushing_yards", scope: { type: "last-games", season: 2026, games: 3 }, per: "game", value: 164.7, label: "Rushing yards" },
          { team: "SEA", stat: "passing_yards", scope: { type: "game", gameId: "2026_05_SF_SEA" }, value: 195, label: "Passing yards" },
        ],
      },
      body: breakdownOutput.body,
    });

    const result = await publish({
      job: "thursday-preview",
      date: "2026-11-26",
      sources: fakeSources(snapshot),
      writer: { write: async () => [toPreviewDraft(previewOutput), draft] },
    });
    expect(result.status).toBe("published");
  });

  it("becomes a season recap draft, leaving out empty lists", () => {
    expect(toRecapDraft(recapOutput)).toEqual({
      type: "season-recap",
      data: { title: "Six and one", sources: recapOutput.sources },
      body: recapOutput.body,
    });
  });
});

describe("Claude preview writer brief", () => {
  const jobOn = (date: string, contentTypes: Job["contentTypes"]): Job => ({
    type: "thursday-preview",
    date,
    contentTypes,
    calendar: resolveCalendar(date, snapshot.schedule!),
  });

  it("names the upcoming game, the previous result, and the record for a Game Preview", () => {
    const brief = renderPreviewBrief(jobOn("2026-11-26", ["game-preview"]), snapshot);

    expect(brief).toContain("Upcoming game: 2026 Week 12, vs SEA, kickoff Sun, Nov 29, 1:25 PM PT (2026_12_SEA_SF)");
    expect(brief).toContain("Previous game: 2026 Week 11, vs MIN (neutral site), won 35-10");
    expect(brief).toContain("49ers record this season: 9-1");
    expect(brief).toContain(`url: ${SHANAHAN_URL}`);
  });

  it("gives the Stat Breakdown both teams' nflverse lines and totals, as the stat check counts them", () => {
    const brief = renderStatBreakdownBrief(jobOn("2026-11-26", ["game-preview", "stat-breakdown"]), snapshot);

    expect(brief).toContain("Upcoming game: 2026 Week 12, vs SEA");
    expect(brief).toContain("SF game by game:\n- 2026_01_SF_LA (Week 1, against LA): completions 25, attempts 34, passing_yards 205");
    expect(brief).toContain("- 2026_05_SF_SEA (Week 5, against SF): completions 18, attempts 29, passing_yards 195");
    expect(brief).toContain("SF 2026 season (10 games): completions 207, attempts 291, passing_yards 2629");
    expect(brief).toMatch(/SF last 3 games of 2026 \(3 games\): .*rushing_yards 494/);
    expect(brief).toContain("- Brock Purdy (QB, SF), 2026 season (10 games): completions 206, attempts 290, passing_yards 2624, passing_tds 23");
    expect(brief).toContain("- Jaxon Smith-Njigba (WR, SEA), last 3 games of 2026 (3 games): ");
    expect(brief).not.toContain("Fred Warner (MLB, SF), 2026 season (10 games): completions");
  });

  it("names the bye and the next game for a season recap", () => {
    const brief = renderPreviewBrief(jobOn("2026-10-29", ["season-recap"]), snapshot);

    expect(brief).toContain("Bye Week: 2026 Week 8");
    expect(brief).toContain("Next game: 2026 Week 9, vs LV");
    expect(brief).toContain("2026 Week 7, at ATL, lost 20-29");
  });
});
