// The real content writer for the Thursday preview job: asks Claude for the Game Preview in a
// Game Week, with the Stat Breakdown beside it, or the season recap in a Bye Week.
//
// Like the news writer, it uses structured output so the reply has the content type's shape,
// and the pipeline still validates the draft and runs every publish check. The pipeline fills
// in the game itself (opponent, kickoff, week) and the record from the schedule, so Claude
// writes only the take: storylines, keys, a prediction, and the narrative.
import { z } from "zod";
import { GAME_STATUSES, PRACTICE_STATUSES } from "../../../content/news-summary";
import { formatRecord } from "../../../site/game-weeks";
import type { StatScope } from "../../../content/cited-stat";
import { seasonRecord, TEAM } from "../../calendar";
import { scopeText } from "../../stats";
import type { ContentWriter, DraftEntry, Job, SourceSnapshot } from "../../types";
import { claudeAsker, type ClaudeOptions } from "./claude";
import { BRIEF_COLUMNS, columns, describeGame, lookup, NOTABLE, renderDocuments, statOutput, toCitedStat } from "./stats-brief";
import { NUMBERS_RULE } from "./writer-output";

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

const statBreakdownOutputSchema = z.object({ title: z.string(), body: z.string(), trends: z.array(z.string()), stats: z.array(statOutput) });
export type StatBreakdownOutput = z.infer<typeof statBreakdownOutputSchema>;

const SHARED_RULES = `Use only what the source snapshot says: the 49ers' schedule and results, the official injury report, and the documents. Never invent a stat, a result, an injury, or a quote.
- sources: every document you rely on, each with its exact "url" and its "outlet" as given in the snapshot. Never invent or alter a URL. At least one source.
- injuries: for every player whose practice participation or game status you state, one entry with the player's name exactly as it appears in the official injury report, and practiceStatus (DNP, LP, FP) and/or gameStatus (Out, Doubtful, Questionable) exactly as the official report gives them; null for any status you don't state. Only state statuses the official report gives.
- quotes: every quotation in the body (any words of yours in double quotation marks count, wherever you write them). Each has the quoted words in "text", the "speaker", and in "source" the url of the document where those exact words appear (one of your sources). Copy quotes word for word, character for character: no paraphrase, no ellipses. If you cannot quote exactly, paraphrase without quotation marks.
- body: Markdown paragraphs. No headings, no links in the body.
${NUMBERS_RULE}`;

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
Use only the brief's nflverse numbers. Never invent a stat. Every stat is checked against nflverse, and a single wrong number stops the whole page from publishing, so prefer the totals the brief gives you over working out new ones.
${NUMBERS_RULE}`;

/** The user turn: the job, where it falls on the calendar, the season's results, and the snapshot. */
export function renderPreviewBrief(job: Job, snapshot: SourceSnapshot): string {
  const calendar = job.calendar;
  const what = calendar?.period === "game-week" ? "Game Preview" : "Bye Week season recap";
  return [
    ...situation(job, snapshot, what),
    ...renderDocuments(snapshot.documents),
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
          `Upcoming game: ${describeGame(calendar.upcoming)}`,
          `Previous game: ${calendar.previous ? describeGame(calendar.previous) : "none (this is the season's first game)"}`,
        ]
      : [`Bye Week: ${calendar.season} Week ${calendar.week}`, `Next game: ${describeGame(calendar.upcoming)}`];
  return [
    `Job: Thursday ${what} for ${job.date} (team-local date).`,
    ...games,
    `49ers record this season: ${formatRecord(seasonRecord(schedule, calendar.season, job.date))}`,
    `Results this season:\n${season.map((game) => `- ${describeGame(game)}`).join("\n") || "- none yet"}`,
    `Official injury report (structured): ${snapshot.injuryReport ? JSON.stringify(snapshot.injuryReport) : "not available"}`,
  ];
}

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
      stats: output.stats.map(toCitedStat),
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

export type ClaudePreviewWriterOptions = ClaudeOptions;

export function claudePreviewWriter(options: ClaudePreviewWriterOptions = {}): ContentWriter {
  const ask = claudeAsker(options);

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
