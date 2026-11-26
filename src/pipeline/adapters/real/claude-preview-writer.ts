// The real content writer for the Thursday preview job: asks Claude for the Game Preview in a
// Game Week, with the Stat Breakdown beside it, or the season recap in a Bye Week.
//
// Like the news writer, it uses structured output so the reply has the content type's shape,
// and the pipeline still validates the draft and runs every publish check. The pipeline fills
// in the game itself (opponent, kickoff, week) and the record from the schedule, so Claude
// writes only the take: storylines, keys, a prediction, and the narrative.
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { GAME_STATUSES, PRACTICE_STATUSES } from "../../../content/news-summary";
import { formatKickoff, formatRecord, gameWeekName, matchup } from "../../../site/game-weeks";
import { SEASON_TYPES, type StatScope } from "../../../content/cited-stat";
import { seasonRecord, TEAM, type ScheduledGame } from "../../calendar";
import { scopeText, statValue, type NflverseStats, type StatRef } from "../../stats";
import type { ContentWriter, DraftEntry, Job, SourceSnapshot } from "../../types";
import { isSpendLimitError, MODEL, SpendLimitReachedError } from "./claude-writer";

/** The Stat Breakdown's recent trends are over this many games. */
const RECENT_GAMES = 3;

const sources = z.array(z.object({ url: z.string(), outlet: z.string() }));
const injuries = z.array(
  z.object({
    player: z.string(),
    practiceStatus: z.enum(PRACTICE_STATUSES).nullable(),
    gameStatus: z.enum(GAME_STATUSES).nullable(),
  }),
);
const quotes = z.array(z.object({ text: z.string(), speaker: z.string(), source: z.string() }));

const previewOutputSchema = z.object({
  title: z.string(),
  body: z.string(),
  storylines: z.array(z.string()),
  keys: z.array(z.string()),
  prediction: z.object({ winner: z.string(), sfScore: z.number().int(), opponentScore: z.number().int() }),
  sources,
  injuries,
  quotes,
});
export type PreviewOutput = z.infer<typeof previewOutputSchema>;

const recapOutputSchema = z.object({ title: z.string(), body: z.string(), sources, injuries, quotes });
export type RecapOutput = z.infer<typeof recapOutputSchema>;

// Structured output takes no unions, so a cited stat's scope comes back flat, with nulls for
// the fields its type doesn't use, and toStatBreakdownDraft() turns it into the cited-stat shape.
const statOutput = z.object({
  player: z.string().nullable(),
  team: z.string(),
  stat: z.string(),
  scope: z.object({
    type: z.enum(["game", "season", "last-games"]),
    gameId: z.string().nullable(),
    season: z.number().int().nullable(),
    seasonType: z.enum(SEASON_TYPES).nullable(),
    games: z.number().int().nullable(),
  }),
  perGame: z.boolean(),
  value: z.number(),
  label: z.string(),
});

const statBreakdownOutputSchema = z.object({ title: z.string(), body: z.string(), trends: z.array(z.string()), stats: z.array(statOutput) });
export type StatBreakdownOutput = z.infer<typeof statBreakdownOutputSchema>;

const SHARED_RULES = `Use only what the source snapshot says: the 49ers' schedule and results, the official injury report, and the documents. Never invent a stat, a result, an injury, or a quote.
- sources: every document you rely on, each with its exact "url" and its "outlet" as given in the snapshot. Never invent or alter a URL. At least one source.
- injuries: for every player whose practice participation or game status you state, one entry with the player's name exactly as it appears in the official injury report, and practiceStatus (DNP, LP, FP) and/or gameStatus (Out, Doubtful, Questionable) exactly as the official report gives them; null for any status you don't state. Only state statuses the official report gives.
- quotes: every quotation in the body. Each has the quoted words in "text", the "speaker", and in "source" the url of the document where those exact words appear (one of your sources). Copy quotes word for word, character for character: no paraphrase, no ellipses. If you cannot quote exactly, paraphrase without quotation marks.
- body: Markdown paragraphs. No headings, no links in the body.`;

/** The Game Preview voice. Stable text, so it is cached across runs. */
export const GAME_PREVIEW_VOICE = `You write the weekly Game Preview for Gold Blooded, an unofficial, non-commercial San Francisco 49ers fan site.

Voice: a knowledgeable, warm 49ers fan writing for other fans. Confident and lively, but honest about the opponent and about the 49ers' weaknesses. No trash talk, no hot takes dressed up as fact. Attribute opinions to whoever holds them.

It is Thursday of the Game Week, after the Wednesday injury report. Write the preview of the upcoming game named in the brief:
- title: a short, plain headline in sentence case.
- body: 3 to 5 short paragraphs on the opponent, what is at stake, and who is likely to play.
- storylines: 2 to 4 one-sentence storylines going into the game.
- keys: 3 to 5 one-sentence keys to the game for the 49ers.
- prediction: the winner ("SF", or the opponent's abbreviation exactly as the brief gives it) and the final score (sfScore for the 49ers, opponentScore for the opponent). The winner must have the higher score; no ties.
${SHARED_RULES}`;

/** The season recap voice, for a Bye Week. */
export const SEASON_RECAP_VOICE = `You write the Bye Week season recap for Gold Blooded, an unofficial, non-commercial San Francisco 49ers fan site.

Voice: a knowledgeable, warm 49ers fan taking stock during the week off. Honest about what has gone well and what hasn't.

The 49ers have no game this week. Look back at the season so far and ahead to what's next:
- title: a short, plain headline in sentence case.
- body: 3 to 5 short paragraphs: the record and how they got there, standout performances the documents mention, the injury picture, and the road ahead starting with the next game.
${SHARED_RULES}`;

/** The Stat Breakdown voice. */
export const STAT_BREAKDOWN_VOICE = `You write the weekly Stat Breakdown for Gold Blooded, an unofficial, non-commercial San Francisco 49ers fan site.

Voice: a sharp, numbers-first 49ers fan. Plain about what the numbers say, including where the opponent is better.

It is Thursday of the Game Week. Break down the upcoming game in numbers: the 49ers' and the opponent's team stats in the context of this matchup, the key players on both sides, and recent trends (the last ${RECENT_GAMES} games against the season).
- title: a short, plain headline in sentence case.
- body: 2 to 4 short Markdown paragraphs on what the numbers say about this matchup. No headings, no links, no tables.
- trends: 2 to 4 one-sentence trends, each comparing recent games with the season, or one team with the other.
- stats: every number the body or trends state, and the 8 to 16 stats the page's tables should show, each as a cited stat:
  - player: the player's name exactly as the brief gives it, or null for a team stat.
  - team: "SF" or the opponent's abbreviation exactly as the brief gives it.
  - stat: the nflverse column name exactly as the brief gives it (passing_yards, rushing_tds, def_sacks, ...), or one of completion_pct, yards_per_attempt, yards_per_carry, yards_per_reception.
  - scope: type "season" (season set, seasonType null for the whole season), "last-games" (season and games set; the player's or team's last N games that season), or "game" (gameId set, as the brief gives it). Null for every field the type doesn't use.
  - perGame: true for a per-game average over the scope (total divided by the games in it), false for a total.
  - value: the number, worked out from the brief's numbers. Round averages and rates to one decimal place.
  - label: how the stat reads in a table, e.g. "Passing yards", "Yards per carry".
Use only the brief's nflverse numbers. Never invent a stat. Every stat is checked against nflverse, and a single wrong number stops the whole page from publishing, so prefer the totals the brief gives you over working out new ones.`;

/** The user turn: the job, where it falls on the calendar, the season's results, and the snapshot. */
export function renderPreviewBrief(job: Job, snapshot: SourceSnapshot): string {
  const calendar = job.calendar;
  const what = calendar?.period === "game-week" ? "Game Preview" : "Bye Week season recap";
  return [
    ...situation(job, snapshot, what),
    `Documents (${snapshot.documents.length}):`,
    ...snapshot.documents.map((doc, i) =>
      [`<document index="${i + 1}">`, `url: ${doc.url}`, `outlet: ${doc.outlet}`, `title: ${doc.title}`, `published: ${doc.publishedAt}`, "text:", doc.text, "</document>"].join("\n"),
    ),
  ].join("\n\n");
}

/** The job, where it falls on the calendar, the season's results, and the injury report. */
function situation(job: Job, snapshot: SourceSnapshot, what: string): string[] {
  const calendar = job.calendar;
  if (!calendar || calendar.period === "offseason") throw new Error("the preview writer writes only in a Game Week or a Bye Week");
  const schedule = snapshot.schedule ?? [];
  const season = schedule.filter((game) => game.season === calendar.season && game.gameday < job.date);
  const games =
    calendar.period === "game-week"
      ? [
          `Upcoming game: ${describe(calendar.upcoming)}`,
          `Previous game: ${calendar.previous ? describe(calendar.previous) : "none (this is the season's first game)"}`,
        ]
      : [`Bye Week: ${calendar.season} Week ${calendar.week}`, `Next game: ${describe(calendar.upcoming)}`];
  return [
    `Job: Thursday ${what} for ${job.date} (team-local date).`,
    ...games,
    `49ers record this season: ${formatRecord(seasonRecord(schedule, calendar.season, job.date))}`,
    `Results this season:\n${season.map((game) => `- ${describe(game)}`).join("\n") || "- none yet"}`,
    `Official injury report (structured): ${snapshot.injuryReport ? JSON.stringify(snapshot.injuryReport) : "not available"}`,
  ];
}

/** nflverse columns the Stat Breakdown brief shows, in this order. */
const BRIEF_COLUMNS = [
  "completions",
  "attempts",
  "passing_yards",
  "passing_tds",
  "passing_interceptions",
  "sacks_suffered",
  "carries",
  "rushing_yards",
  "rushing_tds",
  "receptions",
  "targets",
  "receiving_yards",
  "receiving_tds",
  "def_tackles_solo",
  "def_sacks",
  "def_interceptions",
];

/** A player makes the brief with this much volume over the season in any one column. */
const NOTABLE: Record<string, number> = { attempts: 10, carries: 10, targets: 10, def_tackles_solo: 10, def_sacks: 1, def_interceptions: 1 };


/**
 * The Stat Breakdown's user turn: the situation plus both teams' nflverse lines this season, game
 * by game, and their season and last-3 totals; and the notable players' totals. Totals are worked
 * out by the same lookup the stat check uses, so a total copied from here passes it.
 */
export function renderStatBreakdownBrief(job: Job, snapshot: SourceSnapshot): string {
  const calendar = job.calendar;
  if (calendar?.period !== "game-week") throw new Error("the Stat Breakdown is written only in a Game Week");
  const stats = snapshot.stats;
  const teams = [TEAM, calendar.upcoming.opponent];
  const scopes: StatScope[] = [
    { type: "season", season: calendar.season },
    { type: "last-games", season: calendar.season, games: RECENT_GAMES },
  ];

  const sections = !stats
    ? ["nflverse stats: not available. Cite no stats."]
    : teams.flatMap((team) => {
        const lines = stats.teams.filter((line) => line.team === team && line.season === calendar.season).sort((a, b) => a.week - b.week);
        const players = [...new Set(stats.players.filter((line) => line.team === team && line.season === calendar.season).map((line) => line.player))];
        const notable = players.filter((player) =>
          Object.entries(NOTABLE).some(([column, least]) => lookup(stats, { player, team, stat: column, scope: scopes[0]! }) >= least),
        );
        return [
          `${team} game by game:\n${lines.map((line) => `- ${line.gameId} (Week ${line.week}, against ${line.opponent}): ${columns(BRIEF_COLUMNS, (c) => line.stats[c] ?? 0)}`).join("\n") || "- none yet"}`,
          ...scopes.map((scope) => `${team} ${scopeText(scope)} (${Math.min(lines.length, scope.type === "last-games" ? scope.games : Infinity)} games): ${columns(BRIEF_COLUMNS, (stat) => lookup(stats, { team, stat, scope }))}`),
          `${team} players:\n${notable
            .flatMap((player) =>
              scopes.map((scope) => {
                const games = stats.players.filter((line) => line.player === player && line.team === team && line.season === calendar.season).length;
                const count = scope.type === "last-games" ? Math.min(games, scope.games) : games;
                const position = stats.players.find((line) => line.player === player)?.position ?? "";
                const values = columns(BRIEF_COLUMNS, (stat) => lookup(stats, { player, team, stat, scope }), true);
                return `- ${player} (${position}, ${team}), ${scopeText(scope)} (${count} games): ${values}`;
              }),
            )
            .join("\n") || "- none"}`,
        ];
      });

  return [...situation(job, snapshot, "Stat Breakdown"), `nflverse stats, ${calendar.season} season:`, ...sections].join("\n\n");
}

function lookup(stats: NflverseStats, ref: StatRef): number {
  const found = statValue(stats, ref);
  return "value" in found ? found.value : 0;
}

/** "completions 25, attempts 34, ...", leaving out zeros when asked. */
function columns(names: string[], value: (column: string) => number, skipZeros = false): string {
  return names
    .map((name) => [name, Math.round(value(name) * 100) / 100] as const)
    .filter(([, v]) => !skipZeros || v !== 0)
    .map(([name, v]) => `${name} ${v}`)
    .join(", ");
}

/** "2026 Week 11, vs MIN (neutral site), won 35-10" or "2026 Week 12, vs SEA, kickoff ... (id)". */
function describe(game: ScheduledGame): string {
  const venue = game.neutralSite ? "neutral" : game.home ? "home" : "away";
  const name = `${gameWeekName(game)}, ${matchup({ opponent: game.opponent, venue })}`;
  if (!game.result) return `${name}, kickoff ${formatKickoff(game.kickoff)} (${game.gameId})`;
  const { sf, opponent } = game.result;
  return `${name}, ${sf > opponent ? "won" : sf < opponent ? "lost" : "tied"} ${sf}-${opponent}`;
}

function cleanInjuries(list: z.infer<typeof injuries>) {
  return list.map(({ player, practiceStatus, gameStatus }) => ({
    player,
    ...(practiceStatus && { practiceStatus }),
    ...(gameStatus && { gameStatus }),
  }));
}

/** Claude's Game Preview as a pipeline draft: empty lists and null statuses dropped. */
export function toPreviewDraft(output: PreviewOutput): DraftEntry {
  const injuryList = cleanInjuries(output.injuries);
  return {
    type: "game-preview",
    data: {
      title: output.title,
      storylines: output.storylines,
      keys: output.keys,
      prediction: { winner: output.prediction.winner, score: { sf: output.prediction.sfScore, opponent: output.prediction.opponentScore } },
      sources: output.sources,
      ...(injuryList.length > 0 && { injuries: injuryList }),
      ...(output.quotes.length > 0 && { quotes: output.quotes }),
    },
    body: output.body,
  };
}

/** Claude's Stat Breakdown as a pipeline draft: each stat in the cited-stat shape, nulls dropped. */
export function toStatBreakdownDraft(output: StatBreakdownOutput): DraftEntry {
  return {
    type: "stat-breakdown",
    data: {
      title: output.title,
      trends: output.trends,
      stats: output.stats.map(({ player, team, stat, scope, perGame, value, label }) => ({
        ...(player !== null && { player }),
        team,
        stat,
        scope:
          scope.type === "game"
            ? { type: "game", gameId: scope.gameId }
            : scope.type === "last-games"
              ? { type: "last-games", season: scope.season, games: scope.games }
              : { type: "season", season: scope.season, ...(scope.seasonType && { seasonType: scope.seasonType }) },
        ...(perGame && { per: "game" }),
        value,
        label,
      })),
    },
    body: output.body,
  };
}

/** Claude's season recap as a pipeline draft. */
export function toRecapDraft(output: RecapOutput): DraftEntry {
  const injuryList = cleanInjuries(output.injuries);
  return {
    type: "season-recap",
    data: {
      title: output.title,
      sources: output.sources,
      ...(injuryList.length > 0 && { injuries: injuryList }),
      ...(output.quotes.length > 0 && { quotes: output.quotes }),
    },
    body: output.body,
  };
}

export interface ClaudePreviewWriterOptions {
  client?: Anthropic;
  log?: (message: string) => void;
}

const MAX_ATTEMPTS = 3;

function isRetryable(error: unknown): boolean {
  if (isSpendLimitError(error)) return false;
  if (error instanceof Anthropic.APIConnectionError) return true;
  return error instanceof Anthropic.APIError && (error.status === 408 || error.status === 409 || error.status === 429 || (error.status ?? 0) >= 500);
}

export function claudePreviewWriter(options: ClaudePreviewWriterOptions = {}): ContentWriter {
  // The SDK's own retries would retry a spend-limit 429, so they are off and retries happen here.
  const client = options.client ?? new Anthropic({ maxRetries: 0 });
  const log = options.log ?? ((message: string) => console.log(message));

  async function ask<T extends z.ZodType>(voice: string, schema: T, brief: string): Promise<z.infer<T>> {
    for (let attempt = 1; ; attempt++) {
      try {
        const response = await client.beta.messages.parse({
          model: MODEL,
          max_tokens: 16000,
          betas: ["server-side-fallback-2026-07-01"],
          fallbacks: "default",
          output_config: { effort: "medium", format: betaZodOutputFormat(schema) },
          system: [{ type: "text", text: voice, cache_control: { type: "ephemeral" } }],
          messages: [{ role: "user", content: brief }],
        });
        const usage = response.usage;
        log(
          `Claude (${response.model}): stop_reason ${response.stop_reason}; input ${usage.input_tokens} ` +
            `(cache read ${usage.cache_read_input_tokens ?? 0}), output ${usage.output_tokens} tokens`,
        );
        if (response.stop_reason === "refusal") throw new Error(`Claude declined to write (${response.stop_details?.category ?? "no category"})`);
        if (response.stop_reason === "max_tokens") throw new Error("Claude's reply was cut off at max_tokens");
        if (!response.parsed_output) throw new Error(`Claude's reply didn't match the schema (${response.stop_reason})`);
        return response.parsed_output as z.infer<T>;
      } catch (error) {
        if (isSpendLimitError(error)) throw new SpendLimitReachedError(error);
        if (attempt >= MAX_ATTEMPTS || !isRetryable(error)) throw error;
        const delay = 2 ** attempt * 5_000;
        log(`Claude request failed (${error instanceof Error ? error.message : error}); retrying in ${delay / 1000}s`);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  return {
    async write(job, snapshot) {
      const brief = renderPreviewBrief(job, snapshot);
      if (job.contentTypes?.includes("game-preview")) {
        const [preview, breakdown] = await Promise.all([
          ask(GAME_PREVIEW_VOICE, previewOutputSchema, brief),
          job.contentTypes.includes("stat-breakdown")
            ? ask(STAT_BREAKDOWN_VOICE, statBreakdownOutputSchema, renderStatBreakdownBrief(job, snapshot))
            : undefined,
        ]);
        return [toPreviewDraft(preview), ...(breakdown ? [toStatBreakdownDraft(breakdown)] : [])];
      }
      if (job.contentTypes?.includes("season-recap")) return [toRecapDraft(await ask(SEASON_RECAP_VOICE, recapOutputSchema, brief))];
      throw new Error(`the preview writer doesn't write ${job.contentTypes?.join(", ") || "nothing"}`);
    },
  };
}
