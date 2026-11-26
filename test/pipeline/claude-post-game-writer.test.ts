// The Claude post-game writer: the briefs it sends, and turning its structured output into drafts
// the pipeline publishes. Claude is a fake client; nothing here calls it.
import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { publish, type Job, type SourceSnapshot } from "../../src/pipeline";
import {
  claudePostGameWriter,
  HIGHLIGHTS_VOICE,
  renderHighlightsBrief,
  renderSeasonStatsBrief,
  SEASON_STATS_VOICE,
  toHighlightsDraft,
  toSeasonStatsDraft,
  type HighlightsOutput,
  type SeasonStatsOutput,
} from "../../src/pipeline/adapters/real/claude-post-game-writer";
import { resolveCalendar } from "../../src/pipeline/calendar";
import { POST_GAME_CONTENT } from "../../src/pipeline/publish";
import { fakeSources, recordedSnapshot } from "../support/fakes";

const GAME = "2026_11_MIN_SF";
const snapshot: SourceSnapshot = {
  ...recordedSnapshot("thursday-preview-2026-11-26"),
  videos: [
    {
      videoId: "jsOA0SpFHM4",
      title: "San Francisco 49ers vs. Minnesota Vikings Highlights | Week 11",
      channel: "San Francisco 49ers",
      url: "https://www.youtube.com/watch?v=jsOA0SpFHM4",
      publishedAt: "2026-11-23T05:34:01+00:00",
      description: "Watch the top plays.",
    },
  ],
};
const job: Job = { type: "post-game", date: "2026-11-23", contentTypes: POST_GAME_CONTENT, calendar: resolveCalendar("2026-11-23", snapshot.schedule!) };

const gameStat = (player: string | null, stat: string, value: number, label: string) => ({
  player,
  team: "SF",
  stat,
  scope: { type: "game" as const, gameId: GAME, season: null, seasonType: null, games: null },
  perGame: false,
  value,
  label,
});

const highlightsOutput: HighlightsOutput = {
  title: "Purdy and Kittle carve up Minnesota",
  body: "A clinical night in Mexico City.",
  standouts: [{ player: "Brock Purdy", team: "SF", writeUp: "Three touchdowns." }],
  stats: [gameStat("Brock Purdy", "passing_yards", 255, "Passing yards"), gameStat("Brock Purdy", "passing_tds", 3, "Passing TDs")],
  clips: [{ videoId: "jsOA0SpFHM4", title: "49ers vs. Vikings Highlights", channel: "San Francisco 49ers" }],
  sources: [],
  quotes: [],
};

const seasonStatsOutput: SeasonStatsOutput = {
  body: "Nine wins in ten.",
  stats: [
    {
      player: null,
      team: "SF",
      stat: "rushing_yards",
      scope: { type: "season", gameId: null, season: 2026, seasonType: null, games: null },
      perGame: true,
      value: 138.6,
      label: "Rushing yards",
    },
  ],
};

describe("Claude post-game writer output", () => {
  it("becomes Highlights and Season Stats drafts, of cited stats, that the pipeline publishes", async () => {
    const highlights = toHighlightsDraft(highlightsOutput);
    expect(highlights).toEqual({
      type: "highlights",
      data: {
        title: "Purdy and Kittle carve up Minnesota",
        standouts: highlightsOutput.standouts,
        stats: [
          { player: "Brock Purdy", team: "SF", stat: "passing_yards", scope: { type: "game", gameId: GAME }, value: 255, label: "Passing yards" },
          { player: "Brock Purdy", team: "SF", stat: "passing_tds", scope: { type: "game", gameId: GAME }, value: 3, label: "Passing TDs" },
        ],
        clips: highlightsOutput.clips,
      },
      body: highlightsOutput.body,
    });
    const seasonStats = toSeasonStatsDraft(seasonStatsOutput);
    expect(seasonStats).toEqual({
      type: "season-stats",
      data: { stats: [{ team: "SF", stat: "rushing_yards", scope: { type: "season", season: 2026 }, per: "game", value: 138.6, label: "Rushing yards" }] },
      body: "Nine wins in ten.",
    });

    const result = await publish({ job: "post-game", date: "2026-11-23", sources: fakeSources(snapshot), writer: { write: async () => [highlights, seasonStats] } });
    expect(result.status).toBe("published");
  });
});

describe("Claude post-game writer briefs", () => {
  it("gives the Highlights the game's result, both teams' lines from it, and the official clips", () => {
    const brief = renderHighlightsBrief(job, snapshot);

    expect(brief).toContain(`Game just played: 2026 Week 11, vs MIN (neutral site), won 35-10 (${GAME})`);
    expect(brief).toContain("SF team: completions 22, attempts 27, passing_yards 260, passing_tds 3");
    expect(brief).toContain("MIN team: none in nflverse");
    expect(brief).toContain("- Brock Purdy (QB, SF): completions 21, attempts 26, passing_yards 255, passing_tds 3, sacks_suffered 1");
    expect(brief).toContain("- George Kittle (TE, SF): receptions 3, targets 3, receiving_yards 34, receiving_tds 2");
    expect(brief).toContain('videoId: jsOA0SpFHM4\nchannel: San Francisco 49ers\ntitle: San Francisco 49ers vs. Minnesota Vikings Highlights | Week 11');
  });

  it("says there are no clips when the snapshot has none", () => {
    expect(renderHighlightsBrief(job, { ...snapshot, videos: [] })).toContain("Official clips: none. Return an empty list of clips.");
  });

  it("gives Season Stats the record and the 49ers' season totals, as the stat check counts them", () => {
    const brief = renderSeasonStatsBrief(job, snapshot);

    expect(brief).toContain("49ers record this season: 9-1");
    expect(brief).toContain("SF 2026 season (10 games): completions 207, attempts 291, passing_yards 2629");
    expect(brief).toContain("- Brock Purdy (QB, SF), 2026 season (10 games): completions 206, attempts 290, passing_yards 2624, passing_tds 23");
    // Season Stats are the 49ers' own: no opponent's players.
    expect(brief).not.toContain("Jaxon Smith-Njigba");
  });
});

describe("Claude post-game writer", () => {
  it("asks Claude once for each content type the job writes, in its own voice", async () => {
    const asked: string[] = [];
    const client = {
      beta: {
        messages: {
          parse: async (request: { system: { text: string }[] }) => {
            const voice = request.system[0]!.text;
            asked.push(voice);
            return {
              model: "claude-opus-5-5",
              stop_reason: "end_turn",
              usage: { input_tokens: 1, output_tokens: 1 },
              parsed_output: voice === HIGHLIGHTS_VOICE ? highlightsOutput : seasonStatsOutput,
            };
          },
        },
      },
    } as unknown as Anthropic;

    const drafts = await claudePostGameWriter({ client, log: () => {} }).write(job, snapshot);

    expect(asked.sort()).toEqual([HIGHLIGHTS_VOICE, SEASON_STATS_VOICE].sort());
    expect(drafts.map((draft) => draft.type)).toEqual(["highlights", "season-stats"]);
  });
});
