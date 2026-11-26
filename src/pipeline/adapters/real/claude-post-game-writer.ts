// The real content writer for the post-game job: the day after a game, asks Claude for each
// content type the job writes, one request per type, in its own voice. Today that is the
// Highlights of the game just played, the season's Season Stats, and for the Purdy Shrine the
// Love Letter and a new Reason We Love Brock.
//
// Each type is one entry in POST_GAME_WRITERS: its voice, its structured-output schema, its brief,
// and how its reply becomes a draft. Later post-game content adds its own entry, and the job asks
// for it by adding its type to POST_GAME_CONTENT in publish.ts.
//
// The pipeline fills in the game, its final score, and the record from the schedule, sets the
// Love Letter's variant from nflverse (DNP), and checks every stat against nflverse, every
// injury status against the official report, and every clip against the official channels' videos.
import { z } from "zod";
import { formatRecord } from "../../../site/game-weeks";
import { seasonRecord, TEAM } from "../../calendar";
import { GAME_STATUSES, PRACTICE_STATUSES } from "../../../content/news-summary";
import { PURDY } from "../../../content/purdy-shrine";
import { playedGame } from "../../content-types";
import { purdyPlayed } from "../../purdy";
import { scopeText } from "../../stats";
import type { ContentType, ContentWriter, DraftEntry, Job, SourceSnapshot } from "../../types";
import { claudeAsker, type ClaudeOptions } from "./claude";
import { BRIEF_COLUMNS, columns, describeGame, lookup, NOTABLE, renderDocuments, statOutput, toCitedStat } from "./stats-brief";
import { NUMBERS_RULE } from "./writer-output";

const highlightsOutputSchema = z.object({
  title: z.string(),
  body: z.string(),
  standouts: z.array(z.object({ player: z.string(), team: z.string(), writeUp: z.string() })),
  stats: z.array(statOutput),
  clips: z.array(z.object({ videoId: z.string(), title: z.string(), channel: z.string() })),
  sources: z.array(z.object({ url: z.string(), outlet: z.string() })),
  quotes: z.array(z.object({ text: z.string(), speaker: z.string(), source: z.string() })),
});
export type HighlightsOutput = z.infer<typeof highlightsOutputSchema>;

const seasonStatsOutputSchema = z.object({ body: z.string(), stats: z.array(statOutput) });
export type SeasonStatsOutput = z.infer<typeof seasonStatsOutputSchema>;

const STAT_FIELDS = `  - player: the player's name exactly as the brief gives it, or null for a team stat.
  - stat: the nflverse column name exactly as the brief gives it (passing_yards, rushing_tds, def_sacks, ...), or one of completion_pct, yards_per_attempt, yards_per_carry, yards_per_reception.
  - perGame: true for a per-game average over the scope (total divided by the games in it), false for a total.
  - value: the number, copied from the brief, or worked out from it. Round averages and rates to one decimal place.
  - label: how the stat reads, e.g. "Passing yards", "Yards per carry".
Use only the brief's nflverse numbers. Never invent a stat. Every stat is checked against nflverse, and a single wrong number stops the whole run from publishing, so prefer the totals the brief gives you over working out new ones.
${NUMBERS_RULE}`;

/** The Highlights voice. Stable text, so it is cached across runs. */
export const HIGHLIGHTS_VOICE = `You write the Highlights for Gold Blooded, an unofficial, non-commercial San Francisco 49ers fan site: written spotlights on the standout players from the game the 49ers just played.

Voice: a knowledgeable, warm 49ers fan the morning after the game. Lively, specific, and honest: after a loss, still name who played well, and don't pretend it was a win.

Write:
- title: a short, plain headline in sentence case.
- body: 1 or 2 short Markdown paragraphs on how the game went. No headings, no links.
- standouts: 3 to 5 standout players, mostly 49ers (an opponent only when he decided the game). For each: player and team exactly as the brief gives them, and writeUp, one or two sentences on what he did.
- stats: each standout's stat line, as cited stats from this game (2 to 4 per standout), plus any number the body states:
  - team: "SF" or the opponent's abbreviation, exactly as the brief gives it.
  - scope: type "game" with gameId the game's id as the brief gives it; season, seasonType, and games null.
${STAT_FIELDS}
- clips: official videos worth embedding (the game's highlights first, then a standout's big play), 0 to 3, each exactly as the brief lists it: videoId, title, channel. Only videos the brief lists; never any other id. If none fit, an empty list.
- sources: every document you rely on, with its exact "url" and "outlet" as given; an empty list if you rely only on the stats.
- quotes: every quotation in the body (any words of yours in double quotation marks count, wherever you write them), word for word from the document whose url is its "source" (one of your sources). If you cannot quote exactly, paraphrase without quotation marks.`;

/** The Season Stats voice. */
export const SEASON_STATS_VOICE = `You keep the Season Stats for Gold Blooded, an unofficial, non-commercial San Francisco 49ers fan site: the 49ers' team and player numbers for the whole season up to the latest game, rewritten the day after every game.

Voice: a sharp, numbers-first 49ers fan. Plain about what the numbers say, good or bad.

Write:
- body: 1 or 2 short Markdown paragraphs on where the season stands in numbers after the latest game. No headings, no links, no tables.
- stats: the 12 to 24 numbers the page's tables should show: the 49ers' team totals and per-game averages (passing, rushing, defense), and their leading players' season totals, as cited stats:
  - team: "SF". Only 49ers stats.
  - scope: type "season" with season the season's year as the brief gives it; gameId, seasonType, and games null.
${STAT_FIELDS}`;

/** The game just played, its result, and the season so far: what every post-game brief starts with. */
function situation(job: Job, snapshot: SourceSnapshot, what: string): string[] {
  const game = playedGame(job, what);
  const schedule = snapshot.schedule ?? [];
  const season = schedule.filter((g) => g.season === game.season && g.gameday < job.date);
  return [
    `Job: post-game ${what} for ${job.date} (team-local date), the day after the game.`,
    `Game just played: ${describeGame(game)} (${game.gameId})`,
    `49ers record this season: ${formatRecord(seasonRecord(schedule, game.season, job.date))}`,
    `Results this season:\n${season.map((g) => `- ${describeGame(g)}`).join("\n")}`,
  ];
}

/** The Highlights' user turn: the game, both teams' nflverse lines from it, the official clips, and the documents. */
export function renderHighlightsBrief(job: Job, snapshot: SourceSnapshot): string {
  const game = playedGame(job, "Highlights");
  const stats = snapshot.stats;
  const lines = !stats
    ? ["nflverse stats: not available. Cite no stats."]
    : [TEAM, game.opponent].flatMap((team) => {
        const teamLine = stats.teams.find((line) => line.gameId === game.gameId && line.team === team);
        const players = stats.players.filter((line) => line.gameId === game.gameId && line.team === team);
        return [
          `${team} team: ${teamLine ? columns(BRIEF_COLUMNS, (column) => teamLine.stats[column] ?? 0) : "none in nflverse"}`,
          `${team} players:\n${players.map((line) => `- ${line.player} (${line.position}, ${team}): ${columns(BRIEF_COLUMNS, (column) => line.stats[column] ?? 0, true)}`).join("\n") || "- none in nflverse"}`,
        ];
      });
  const videos = snapshot.videos ?? [];
  const clips =
    videos.length === 0
      ? ["Official clips: none. Return an empty list of clips."]
      : [
          `Official clips (${videos.length}):`,
          ...videos.map((video) => [`videoId: ${video.videoId}`, `channel: ${video.channel}`, `title: ${video.title}`, `published: ${video.publishedAt}`, `description: ${video.description.slice(0, 300)}`].join("\n")),
        ];
  return [...situation(job, snapshot, "Highlights"), `nflverse stats for game ${game.gameId}:`, ...lines, ...clips, ...renderDocuments(snapshot.documents)].join("\n\n");
}

/** Season Stats' user turn: the record and the 49ers' season totals, team and notable players, as the stat check counts them. */
export function renderSeasonStatsBrief(job: Job, snapshot: SourceSnapshot): string {
  const game = playedGame(job, "Season Stats");
  const stats = snapshot.stats;
  const scope = { type: "season" as const, season: game.season };
  const totals = !stats
    ? ["nflverse stats: not available. Cite no stats."]
    : (() => {
        const games = stats.teams.filter((line) => line.team === TEAM && line.season === game.season).length;
        const players = [...new Set(stats.players.filter((line) => line.team === TEAM && line.season === game.season).map((line) => line.player))];
        const notable = players.filter((player) => Object.entries(NOTABLE).some(([column, least]) => lookup(stats, { player, team: TEAM, stat: column, scope }) >= least));
        return [
          `${TEAM} ${scopeText(scope)} (${games} games): ${columns(BRIEF_COLUMNS, (stat) => lookup(stats, { team: TEAM, stat, scope }))}`,
          `${TEAM} players:\n${notable
            .map((player) => {
              const lines = stats.players.filter((line) => line.player === player && line.team === TEAM && line.season === game.season);
              const values = columns(BRIEF_COLUMNS, (stat) => lookup(stats, { player, team: TEAM, stat, scope }), true);
              return `- ${player} (${lines[0]?.position ?? ""}, ${TEAM}), ${scopeText(scope)} (${lines.length} games): ${values}`;
            })
            .join("\n") || "- none"}`,
        ];
      })();
  return [...situation(job, snapshot, "Season Stats"), `nflverse stats, ${game.season} season:`, ...totals].join("\n\n");
}

/** Claude's Highlights as a pipeline draft: each stat in the cited-stat shape, empty lists dropped. */
export function toHighlightsDraft(output: HighlightsOutput): DraftEntry {
  return {
    type: "highlights",
    data: {
      title: output.title,
      standouts: output.standouts,
      stats: output.stats.map(toCitedStat),
      ...(output.clips.length > 0 && { clips: output.clips }),
      ...(output.sources.length > 0 && { sources: output.sources }),
      ...(output.quotes.length > 0 && { quotes: output.quotes }),
    },
    body: output.body,
  };
}

/** Claude's Season Stats as a pipeline draft. */
export function toSeasonStatsDraft(output: SeasonStatsOutput): DraftEntry {
  return { type: "season-stats", data: { stats: output.stats.map(toCitedStat) }, body: output.body };
}

// The Purdy Shrine (#10): the Love Letter and the new Reason We Love Brock.

const loveLetterOutputSchema = z.object({
  title: z.string(),
  body: z.string(),
  stats: z.array(statOutput),
  injuries: z.array(z.object({ player: z.string(), practiceStatus: z.enum(PRACTICE_STATUSES).nullable(), gameStatus: z.enum(GAME_STATUSES).nullable() })),
  sources: z.array(z.object({ url: z.string(), outlet: z.string() })),
  quotes: z.array(z.object({ text: z.string(), speaker: z.string(), source: z.string() })),
});
export type LoveLetterOutput = z.infer<typeof loveLetterOutputSchema>;

const reasonOutputSchema = z.object({ reason: z.string() });
export type ReasonOutput = z.infer<typeof reasonOutputSchema>;

const SHRINE_RULES = `The Purdy Shrine is family-friendly. Write only about Brock Purdy the football player: his play, his poise, his work, how he leads and treats teammates and fans. Never write about his personal life, his family, his relationships, his money, or his life off the field, even when a document mentions them.`;

/** The Love Letter voice. Stable text, so it is cached across runs. */
export const LOVE_LETTER_VOICE = `You write the Love Letter for the Purdy Shrine on Gold Blooded, an unofficial, non-commercial San Francisco 49ers fan site: a weekly letter to Brock Purdy, written the day after each 49ers game.

Voice: lovestruck. We are hopelessly, shamelessly in love with Brock Purdy, the quarterback who went from Mr. Irrelevant (the last pick of the 2022 draft) to Mr. Everything. Swooning, sweet, funny, sincere. The letter stays adoring however the game went: after a loss or a rough day, we love him anyway, and say so, without pretending the game went well.

${SHRINE_RULES}

The brief tells you the letter's variant, worked out from nflverse; follow it:
- adoring: he played. Write about his game: what he did that we loved.
- we-miss-you: he did not play (DNP). Write a "we miss you" letter: how much we missed him, how the week felt without him, how we can't wait to have him back. Cite no stats from this game; he has none.

Injuries: mention an injury only as far as the official injury report in the brief goes, and only his. If the report lists him, you may say what it says (his practice status, his game status) and nothing more: no diagnosis beyond it, no timeline, no speculation, no rumours. If the report doesn't list him, don't mention an injury at all. Every injury status you mention goes in injuries; a single one that doesn't match the official report stops the whole run.

Write:
- title: a short headline in sentence case, like the opening of a letter ("Dear Brock, ...").
- body: 2 to 4 short Markdown paragraphs, written to him. No headings, no links.
- stats: every number about him that the body states, as cited stats of Brock Purdy's:
  - player: "Brock Purdy". team: "SF".
  - scope: type "game" with gameId the game's id for this game's numbers, or type "season" with season the season's year for his season so far; the other scope fields null.
  - stat, perGame, value, label as in the brief's nflverse numbers. Use only the brief's numbers; never invent one. Every stat is checked against nflverse, and a single wrong number stops the whole run.
- injuries: each injury status the body mentions: player "Brock Purdy", practiceStatus and gameStatus exactly as the official report gives them (null for one it doesn't give). An empty list if the body mentions no injury.
- sources: every document you rely on, with its exact "url" and "outlet" as given; an empty list if you rely only on the brief's numbers.
- quotes: every quotation in the body (any words of yours in double quotation marks count, wherever you write them), word for word from the document whose url is its "source" (one of your sources). If you cannot quote exactly, paraphrase without quotation marks.
${NUMBERS_RULE}`;

/** The voice for the new Reason We Love Brock. */
export const REASONS_VOICE = `You add to "Reasons We Love Brock" on the Purdy Shrine of Gold Blooded, an unofficial, non-commercial San Francisco 49ers fan site: a running list of reasons we are hopelessly in love with Brock Purdy. After each game, the list gets one new reason.

Voice: lovestruck, sweet, a little funny.

${SHRINE_RULES}

Write:
- reason: one new reason, one sentence, inspired by the game just played or by what he is like as a player. In our own words, with no numbers or digits at all (no stats, scores, or dates), and not one the list already has, even reworded.`;

/** Purdy's injury report line, as the brief gives it. */
function injuryLine(snapshot: SourceSnapshot): string {
  if (!snapshot.injuryReport) return `${PURDY.player} on the official injury report: there is no official report in the sources. Mention no injury.`;
  const line = snapshot.injuryReport.find((entry) => entry.player === PURDY.player);
  if (!line) return `${PURDY.player} on the official injury report: not listed. Mention no injury.`;
  const parts = [line.practiceStatus && `practice status ${line.practiceStatus}`, line.gameStatus && `game status ${line.gameStatus}`].filter(Boolean);
  return `${PURDY.player} on the official injury report: ${parts.join(", ") || "listed, with no status"}.`;
}

/** The Love Letter's user turn: the game, the variant (from nflverse), his numbers, and his injury report line. */
export function renderLoveLetterBrief(job: Job, snapshot: SourceSnapshot): string {
  const game = playedGame(job, "Love Letters");
  const stats = snapshot.stats;
  const played = purdyPlayed(stats, game.gameId);
  const scope = { type: "season" as const, season: game.season };
  const line = stats!.players.find((l) => l.gameId === game.gameId && l.playerId === PURDY.playerId);
  const seasonGames = stats!.players.filter((l) => l.playerId === PURDY.playerId && l.season === game.season).length;
  return [
    ...situation(job, snapshot, "Love Letter"),
    played
      ? `Love Letter variant: adoring. ${PURDY.player} played in this game.`
      : `Love Letter variant: we-miss-you. ${PURDY.player} did not play in this game (DNP).`,
    line
      ? `${PURDY.player} in game ${game.gameId}: ${columns(BRIEF_COLUMNS, (column) => line.stats[column] ?? 0, true)}`
      : `${PURDY.player} in game ${game.gameId}: no nflverse line (DNP). Cite no stats from this game.`,
    `${PURDY.player}, ${scopeText(scope)} (${seasonGames} games): ${columns(BRIEF_COLUMNS, (stat) => lookup(stats!, { player: PURDY.player, team: TEAM, stat, scope }), true)}`,
    injuryLine(snapshot),
    ...renderDocuments(snapshot.documents),
  ].join("\n\n");
}

/** The new reason's user turn: the game just played and the reasons already on the list. */
export function renderReasonBrief(job: Job, snapshot: SourceSnapshot): string {
  const game = playedGame(job, "Reasons We Love Brock");
  const reasons = snapshot.current?.["reasons-we-love-brock"]?.data.reasons ?? [];
  return [
    `Job: post-game Reasons We Love Brock for ${job.date}, the day after the game.`,
    `Game just played: ${describeGame(game)}`,
    purdyPlayed(snapshot.stats, game.gameId) ? `${PURDY.player} played.` : `${PURDY.player} did not play (DNP). A reason about missing him, or about him in general, fits.`,
    `Reasons already on the list (${reasons.length}):\n${reasons.map((item) => `- ${item.reason}`).join("\n") || "- none yet"}`,
  ].join("\n\n");
}

/** Claude's Love Letter as a pipeline draft. The pipeline sets the variant; empty lists are dropped. */
export function toLoveLetterDraft(output: LoveLetterOutput): DraftEntry {
  const injuries = output.injuries.map(({ player, practiceStatus, gameStatus }) => ({ player, ...(practiceStatus && { practiceStatus }), ...(gameStatus && { gameStatus }) }));
  return {
    type: "love-letter",
    data: {
      title: output.title,
      ...(output.stats.length > 0 && { stats: output.stats.map(toCitedStat) }),
      ...(injuries.length > 0 && { injuries }),
      ...(output.sources.length > 0 && { sources: output.sources }),
      ...(output.quotes.length > 0 && { quotes: output.quotes }),
    },
    body: output.body,
  };
}

/** Claude's new reason as a pipeline draft, for the pipeline to add to the list. */
export function toReasonDraft(output: ReasonOutput): DraftEntry {
  return { type: "reasons-we-love-brock", data: { reason: output.reason }, body: "" };
}

interface PostGameWriter<T extends z.ZodType> {
  voice: string;
  schema: T;
  brief(job: Job, snapshot: SourceSnapshot): string;
  toDraft(output: z.infer<T>): DraftEntry;
}

/** One request per post-game content type. */
const POST_GAME_WRITERS: Partial<Record<ContentType, PostGameWriter<z.ZodType>>> = {
  highlights: { voice: HIGHLIGHTS_VOICE, schema: highlightsOutputSchema, brief: renderHighlightsBrief, toDraft: toHighlightsDraft } as PostGameWriter<z.ZodType>,
  "season-stats": { voice: SEASON_STATS_VOICE, schema: seasonStatsOutputSchema, brief: renderSeasonStatsBrief, toDraft: toSeasonStatsDraft } as PostGameWriter<z.ZodType>,
  "love-letter": { voice: LOVE_LETTER_VOICE, schema: loveLetterOutputSchema, brief: renderLoveLetterBrief, toDraft: toLoveLetterDraft } as PostGameWriter<z.ZodType>,
  "reasons-we-love-brock": { voice: REASONS_VOICE, schema: reasonOutputSchema, brief: renderReasonBrief, toDraft: toReasonDraft } as PostGameWriter<z.ZodType>,
};

export type ClaudePostGameWriterOptions = ClaudeOptions;

export function claudePostGameWriter(options: ClaudePostGameWriterOptions = {}): ContentWriter {
  const ask = claudeAsker(options);
  return {
    async write(job, snapshot) {
      const writers = (job.contentTypes ?? []).map((type) => {
        const writer = POST_GAME_WRITERS[type];
        if (!writer) throw new Error(`the post-game writer doesn't write ${type}`);
        return writer;
      });
      return Promise.all(writers.map(async (writer) => writer.toDraft(await ask(writer.voice, writer.schema, writer.brief(job, snapshot)))));
    },
  };
}
