// The Claude post-game writer: the briefs it sends, and turning its structured output into drafts
// the pipeline publishes. Claude is a fake client; nothing here calls it.
import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { publish, type Job, type SourceSnapshot } from "../../src/pipeline";
import {
  claudePostGameWriter,
  HIGHLIGHTS_VOICE,
  LOVE_LETTER_VOICE,
  REASONS_VOICE,
  renderHighlightsBrief,
  renderLoveLetterBrief,
  renderReasonBrief,
  renderSeasonStatsBrief,
  SEASON_STATS_VOICE,
  toHighlightsDraft,
  toLoveLetterDraft,
  toReasonDraft,
  toSeasonStatsDraft,
  type HighlightsOutput,
  type LoveLetterOutput,
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

const loveLetterOutput: LoveLetterOutput = {
  title: "Dear Brock, about Mexico City",
  body: "Three touchdowns, and every one of them landed right in our hearts.",
  stats: [gameStat("Brock Purdy", "passing_tds", 3, "Passing TDs")],
  injuries: [],
  sources: [],
  quotes: [],
};

/** The snapshot with no Purdy line from the Minnesota game (a DNP), and him out on the injury report. */
const purdyOut: SourceSnapshot = {
  ...snapshot,
  stats: { ...snapshot.stats!, players: snapshot.stats!.players.filter((line) => !(line.player === "Brock Purdy" && line.gameId === GAME)) },
  injuryReport: [...snapshot.injuryReport!, { player: "Brock Purdy", practiceStatus: "DNP", gameStatus: "Out" }],
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

    const loveLetter = toLoveLetterDraft(loveLetterOutput);
    expect(loveLetter).toEqual({
      type: "love-letter",
      data: {
        title: "Dear Brock, about Mexico City",
        stats: [{ player: "Brock Purdy", team: "SF", stat: "passing_tds", scope: { type: "game", gameId: GAME }, value: 3, label: "Passing TDs" }],
      },
      body: loveLetterOutput.body,
    });
    const reason = toReasonDraft({ reason: "He never stops smiling." });
    expect(reason).toEqual({ type: "reasons-we-love-brock", data: { reason: "He never stops smiling." }, body: "" });

    const writer = { write: async () => [highlights, seasonStats, loveLetter, reason] };
    const result = await publish({ job: "post-game", date: "2026-11-23", sources: fakeSources(snapshot), writer });
    expect(result.status).toBe("published");
  });

  it("turns a \"we miss you\" letter's injury statuses into the ones the injury check holds to the report", () => {
    const output = { ...loveLetterOutput, stats: [], injuries: [{ player: "Brock Purdy", practiceStatus: null, gameStatus: "Out" as const }] };

    expect(toLoveLetterDraft(output).data).toEqual({ title: output.title, injuries: [{ player: "Brock Purdy", gameStatus: "Out" }] });
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

describe("Claude post-game writer briefs: the Purdy Shrine", () => {
  it("tells the Love Letter he played, with his line from the game and his season so far", () => {
    const brief = renderLoveLetterBrief(job, snapshot);

    expect(brief).toContain("Love Letter variant: adoring. Brock Purdy played in this game.");
    expect(brief).toContain(`Brock Purdy in game ${GAME}: completions 21, attempts 26, passing_yards 255, passing_tds 3`);
    expect(brief).toContain("Brock Purdy, 2026 season (10 games): completions 206, attempts 290, passing_yards 2624, passing_tds 23");
    expect(brief).toContain("Brock Purdy on the official injury report: not listed.");
  });

  it("tells the Love Letter he didn't play, and gives only the official report's word on why", () => {
    const brief = renderLoveLetterBrief(job, purdyOut);

    expect(brief).toContain("Love Letter variant: we-miss-you. Brock Purdy did not play in this game (DNP).");
    expect(brief).toContain(`Brock Purdy in game ${GAME}: no nflverse line (DNP). Cite no stats from this game.`);
    expect(brief).toContain("Brock Purdy on the official injury report: practice status DNP, game status Out.");
  });

  it("gives the reasons brief the list so far, so the new one is new", () => {
    const current = { title: "Reasons We Love Brock", updated: "2026-11-16", reasons: [{ reason: "He thanks his offensive line.", added: "2026-11-16" }] };
    const brief = renderReasonBrief(job, { ...snapshot, current: { "reasons-we-love-brock": { data: current, body: "" } } });

    expect(brief).toContain("Reasons already on the list (1):\n- He thanks his offensive line.");
    expect(brief).toContain("Game just played: 2026 Week 11, vs MIN (neutral site), won 35-10");
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
              parsed_output:
                voice === HIGHLIGHTS_VOICE ? highlightsOutput : voice === SEASON_STATS_VOICE ? seasonStatsOutput : voice === LOVE_LETTER_VOICE ? loveLetterOutput : { reason: "He never stops smiling." },
            };
          },
        },
      },
    } as unknown as Anthropic;

    const drafts = await claudePostGameWriter({ client, log: () => {} }).write(job, snapshot);

    expect(asked.sort()).toEqual([HIGHLIGHTS_VOICE, SEASON_STATS_VOICE, LOVE_LETTER_VOICE, REASONS_VOICE].sort());
    expect(drafts.map((draft) => draft.type)).toEqual(["highlights", "season-stats", "love-letter", "reasons-we-love-brock"]);
  });
});
