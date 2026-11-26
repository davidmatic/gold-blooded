// The real content writer for the Offseason job: asks Claude, once per run, for the day's
// update to both running documents, the Free Agency Tracker and Draft Coverage.
//
// Claude sees each document as it stands and returns only what is new or corrected (today's
// moves, new mock drafts, picks, profiles) plus a fresh overview body; the pipeline folds that
// into the document (src/pipeline/running-documents.ts), validates it, and runs every publish
// check, including that each new item's source names the player.
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { draftDates, FREE_AGENCY_MOVES, offseasonYear } from "../../../content/offseason";
import type { ContentWriter, DraftEntry, Job, SourceSnapshot } from "../../types";
import { isSpendLimitError, MODEL, SpendLimitReachedError } from "./claude-writer";

const source = z.object({ url: z.string(), outlet: z.string() });
const quotes = z.array(z.object({ text: z.string(), speaker: z.string(), source: z.string() }));
const prospect = { player: z.string(), position: z.string(), school: z.string(), source };

const offseasonOutputSchema = z.object({
  freeAgencyTracker: z.object({
    body: z.string(),
    newMoves: z.array(
      z.object({ player: z.string(), position: z.string(), kind: z.enum(FREE_AGENCY_MOVES), date: z.string(), detail: z.string().nullable(), source }),
    ),
    sources: z.array(source),
    quotes,
  }),
  draftCoverage: z.object({
    body: z.string(),
    teamNeeds: z.array(z.object({ position: z.string(), note: z.string() })),
    newMockDrafts: z.array(z.object({ ...prospect, pick: z.number().int() })),
    newPicks: z.array(z.object({ ...prospect, round: z.number().int(), overall: z.number().int() })),
    newProfiles: z.array(z.object({ ...prospect, profile: z.string() })),
    sources: z.array(source),
    quotes,
  }),
});
export type OffseasonOutput = z.infer<typeof offseasonOutputSchema>;

/** The Offseason voice. Stable text, so it is cached across runs. */
export const OFFSEASON_VOICE = `You keep the Offseason coverage for Gold Blooded, an unofficial, non-commercial San Francisco 49ers fan site: the Free Agency Tracker and Draft Coverage. Both are running documents, updated every day of the Offseason.

Voice: a knowledgeable, warm 49ers fan writing for other fans. Factual about moves and picks; opinions, grades, and projections are attributed to whoever holds them ("ESPN's mock draft has..."). No rumours presented as fact.

You are given each document as it stands, the day's documents from Preferred Sources, and the NFL Draft's dates. Return today's update to both documents. Add only what the documents report and the current document doesn't already have; never repeat an item unchanged. To correct an item, return it again with the same player (and kind of move, or overall pick) and the corrected fields.

freeAgencyTracker:
- body: 1 to 3 short paragraphs of Markdown: an overview of the 49ers' free agency so far, rewritten to include today's news. No headings, no links.
- newMoves: each new 49ers signing (a player from elsewhere joining), departure (a 49ers player leaving, released, or traded away), or re-signing (a 49ers player staying). player as the source names him, position abbreviation, the date it was reported (YYYY-MM-DD), detail (terms, or the team he came from or went to; null if unknown), and the source document it came from.

draftCoverage:
- body: 1 to 3 short paragraphs of Markdown, fitting where the date falls around the draft: before it, the needs and what the mocks say; during it, the picks so far; after it, the class as a whole. No headings, no links.
- teamNeeds: the 49ers' biggest needs, 3 to 6, each a position and a one-sentence note, as the documents support them. Return an empty list to keep the current ones.
- newMockDrafts: each new mock draft's projection for the 49ers' first pick: the pick number, the player, position, and school, and the mock draft's document as the source.
- newPicks: each 49ers pick made in the NFL Draft that the documents report: round, overall number, player, position, school, source. Only real picks, never projections.
- newProfiles: for each drafted player without a profile, a one-paragraph profile (what he does well, where he fits) from the documents, with its source.

For both:
- source and sources: each document's exact "url" and "outlet" as given in the snapshot. Never invent or alter a URL. Every item's source must be a document that names the player. sources lists any other documents the body relies on.
- quotes: every quotation in the body, with the quoted words in "text", the "speaker", and in "source" the url of the document where those exact words appear. Copy quotes word for word; if you cannot, paraphrase without quotation marks.
- If there is nothing new, return empty lists and keep the body as it was.`;

/** The user turn: the job, the draft's dates, each running document as it stands, and the documents. */
export function renderOffseasonBrief(job: Job, snapshot: SourceSnapshot): string {
  if (job.calendar?.period !== "offseason") throw new Error("the Offseason writer writes only in the Offseason");
  const year = offseasonYear(job.date);
  const draft = draftDates(year);
  const phase = job.date < draft.start ? "before the draft" : job.date <= draft.end ? "during the draft" : "after the draft";
  const current = (label: string, doc?: { data: object; body: string }) =>
    doc ? `${label} as it stands:\n${JSON.stringify(doc.data)}\nOverview:\n${doc.body}` : `${label} as it stands: none yet (this is its first update)`;

  return [
    `Job: Offseason update for ${job.date} (team-local date), the ${year} Offseason.`,
    `${year} NFL Draft: ${draft.start} to ${draft.end} (${phase}).`,
    current("Free Agency Tracker", snapshot.current?.["free-agency-tracker"]),
    current("Draft Coverage", snapshot.current?.["draft-coverage"]),
    `Documents (${snapshot.documents.length}):`,
    ...snapshot.documents.map((doc, i) =>
      [`<document index="${i + 1}">`, `url: ${doc.url}`, `outlet: ${doc.outlet}`, `title: ${doc.title}`, `published: ${doc.publishedAt}`, "text:", doc.text, "</document>"].join("\n"),
    ),
  ].join("\n\n");
}

/** Claude's update as the two pipeline drafts: null details and empty quote lists dropped. */
export function toOffseasonDrafts(output: OffseasonOutput): DraftEntry[] {
  const { freeAgencyTracker: tracker, draftCoverage: coverage } = output;
  return [
    {
      type: "free-agency-tracker",
      data: {
        moves: tracker.newMoves.map(({ detail, ...move }) => ({ ...move, ...(detail && { detail }) })),
        sources: tracker.sources,
        ...(tracker.quotes.length > 0 && { quotes: tracker.quotes }),
      },
      body: tracker.body,
    },
    {
      type: "draft-coverage",
      data: {
        teamNeeds: coverage.teamNeeds,
        mockDrafts: coverage.newMockDrafts,
        picks: coverage.newPicks,
        profiles: coverage.newProfiles,
        sources: coverage.sources,
        ...(coverage.quotes.length > 0 && { quotes: coverage.quotes }),
      },
      body: coverage.body,
    },
  ];
}

export interface ClaudeOffseasonWriterOptions {
  client?: Anthropic;
  log?: (message: string) => void;
}

const MAX_ATTEMPTS = 3;

function isRetryable(error: unknown): boolean {
  if (isSpendLimitError(error)) return false;
  if (error instanceof Anthropic.APIConnectionError) return true;
  return error instanceof Anthropic.APIError && (error.status === 408 || error.status === 409 || error.status === 429 || (error.status ?? 0) >= 500);
}

export function claudeOffseasonWriter(options: ClaudeOffseasonWriterOptions = {}): ContentWriter {
  // The SDK's own retries would retry a spend-limit 429, so they are off and retries happen here.
  const client = options.client ?? new Anthropic({ maxRetries: 0 });
  const log = options.log ?? ((message: string) => console.log(message));

  return {
    async write(job, snapshot) {
      const brief = renderOffseasonBrief(job, snapshot);
      for (let attempt = 1; ; attempt++) {
        try {
          const response = await client.beta.messages.parse({
            model: MODEL,
            max_tokens: 16000,
            betas: ["server-side-fallback-2026-07-01"],
            fallbacks: "default",
            output_config: { effort: "medium", format: betaZodOutputFormat(offseasonOutputSchema) },
            system: [{ type: "text", text: OFFSEASON_VOICE, cache_control: { type: "ephemeral" } }],
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
          return toOffseasonDrafts(response.parsed_output);
        } catch (error) {
          if (isSpendLimitError(error)) throw new SpendLimitReachedError(error);
          if (attempt >= MAX_ATTEMPTS || !isRetryable(error)) throw error;
          const delay = 2 ** attempt * 5_000;
          log(`Claude request failed (${error instanceof Error ? error.message : error}); retrying in ${delay / 1000}s`);
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
    },
  };
}
