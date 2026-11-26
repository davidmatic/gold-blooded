// The real content writer for the Thursday preview job: asks Claude for the Game Preview in a
// Game Week, or the season recap in a Bye Week.
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
import { seasonRecord, type ScheduledGame } from "../../calendar";
import type { ContentWriter, DraftEntry, Job, SourceSnapshot } from "../../types";
import { isSpendLimitError, MODEL, SpendLimitReachedError } from "./claude-writer";

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

/** The user turn: the job, where it falls on the calendar, the season's results, and the snapshot. */
export function renderPreviewBrief(job: Job, snapshot: SourceSnapshot): string {
  const calendar = job.calendar;
  if (!calendar || calendar.period === "offseason") throw new Error("the preview writer writes only in a Game Week or a Bye Week");
  const schedule = snapshot.schedule ?? [];
  const season = schedule.filter((game) => game.season === calendar.season && game.gameday < job.date);
  const situation =
    calendar.period === "game-week"
      ? [
          `Upcoming game: ${describe(calendar.upcoming)}`,
          `Previous game: ${calendar.previous ? describe(calendar.previous) : "none (this is the season's first game)"}`,
        ]
      : [`Bye Week: ${calendar.season} Week ${calendar.week}`, `Next game: ${describe(calendar.upcoming)}`];

  return [
    `Job: Thursday ${calendar.period === "game-week" ? "Game Preview" : "Bye Week season recap"} for ${job.date} (team-local date).`,
    ...situation,
    `49ers record this season: ${formatRecord(seasonRecord(schedule, calendar.season, job.date))}`,
    `Results this season:\n${season.map((game) => `- ${describe(game)}`).join("\n") || "- none yet"}`,
    `Official injury report (structured): ${snapshot.injuryReport ? JSON.stringify(snapshot.injuryReport) : "not available"}`,
    `Documents (${snapshot.documents.length}):`,
    ...snapshot.documents.map((doc, i) =>
      [`<document index="${i + 1}">`, `url: ${doc.url}`, `outlet: ${doc.outlet}`, `title: ${doc.title}`, `published: ${doc.publishedAt}`, "text:", doc.text, "</document>"].join("\n"),
    ),
  ].join("\n\n");
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
      if (job.contentTypes?.includes("game-preview")) return [toPreviewDraft(await ask(GAME_PREVIEW_VOICE, previewOutputSchema, brief))];
      if (job.contentTypes?.includes("season-recap")) return [toRecapDraft(await ask(SEASON_RECAP_VOICE, recapOutputSchema, brief))];
      throw new Error(`the preview writer doesn't write ${job.contentTypes?.join(", ") || "nothing"}`);
    },
  };
}
