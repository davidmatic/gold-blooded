// What every Claude writer shares: the structured-output shapes of a piece's sources, quotes, and
// injury statuses; turning those into draft fields; the snapshot's documents as a brief shows
// them; and the rules every voice prompt states the same way.
//
// Structured output has no optional fields, so lists always come back (possibly empty) and an
// unset injury status comes back null. The draft helpers drop both, as the content schemas expect.
import { z } from "zod";
import { GAME_STATUSES, PRACTICE_STATUSES } from "../../../content/news-summary";
import type { SourceDocument } from "../../types";

/** One source document a piece relies on. */
export const sourceOutput = z.object({ url: z.string(), outlet: z.string() });
export const sourcesOutput = z.array(sourceOutput);

export const quotesOutput = z.array(z.object({ text: z.string(), speaker: z.string(), source: z.string() }));
export type QuotesOutput = z.infer<typeof quotesOutput>;

export const injuriesOutput = z.array(
  z.object({
    player: z.string(),
    practiceStatus: z.enum(PRACTICE_STATUSES).nullable(),
    gameStatus: z.enum(GAME_STATUSES).nullable(),
  }),
);
export type InjuriesOutput = z.infer<typeof injuriesOutput>;

/** Injury statuses as a draft states them: a null status left out, and no list when there are none. */
export function injuriesField(list: InjuriesOutput): { injuries?: object[] } {
  const injuries = list.map(({ player, practiceStatus, gameStatus }) => ({
    player,
    ...(practiceStatus && { practiceStatus }),
    ...(gameStatus && { gameStatus }),
  }));
  return injuries.length > 0 ? { injuries } : {};
}

/** Quotes as a draft states them: no list when there are none. */
export function quotesField(quotes: QuotesOutput): { quotes?: QuotesOutput } {
  return quotes.length > 0 ? { quotes } : {};
}

/** The snapshot's documents, each in full, for a brief. A podcast episode's says whom to credit. */
export function renderDocuments(documents: readonly SourceDocument[]): string[] {
  return [
    `Documents (${documents.length}):`,
    ...documents.map((doc, i) =>
      [
        `<document index="${i + 1}">`,
        `url: ${doc.url}`,
        `outlet: ${doc.outlet}`,
        ...(doc.podcast ? [`podcast transcript: show "${doc.podcast.show}", hosts: ${doc.podcast.hosts.join(", ")}`] : []),
        `title: ${doc.title}`,
        `published: ${doc.publishedAt}`,
        "text:",
        doc.text,
        "</document>",
      ].join("\n"),
    ),
  ];
}

/** The sources rule. `minimum` says whether a piece needs one (a News Summary) or may rely on the brief's numbers alone. */
export function sourcesRule(minimum: "at least one" | "may be empty"): string {
  return `- sources: every document you rely on, each with its exact "url" and its "outlet" as given in the snapshot. Never invent or alter a URL. ${
    minimum === "at least one" ? "At least one source." : "An empty list if you rely only on the brief's numbers."
  }`;
}

/** The injury statuses rule, checked against the official report. */
export const INJURIES_RULE = `- injuries: for every player whose practice participation or game status you state, one entry with the player's name exactly as it appears in the official injury report, and practiceStatus (DNP, LP, FP) and/or gameStatus (Out, Doubtful, Questionable) exactly as the official report gives them; null for any status you don't state. Only state statuses the official report gives; if it has no game status for a player yet, do not give one.`;

/** The quotes rule, checked word for word. `source` says where a quote's source url comes from. */
export function quotesRule(source = "the url of the document where those exact words appear (one of your sources)"): string {
  return `- quotes: every quotation you write, without exception: any words in double quotation marks count, wherever you write them. Each has the quoted words in "text", the "speaker", and in "source" ${source}. Copy quotes word for word, character for character: no paraphrase, no fixing grammar, no joining sentences that are apart, no ellipses. Keep them short (one or two sentences). If you cannot quote exactly, paraphrase without quotation marks.`;
}

/** The number grounding check (src/pipeline/checks/numbers.ts), as a writer must follow it. */
export const NUMBERS_RULE = `- numbers: every number you write in prose (the title, body, and every other text field) must be either one of your cited stats, at the value you cite (rounded no further than to a whole number), or a number that appears in a document you list as a source. Years, dates, kickoff times, Week numbers, and the scores and records the brief gives are fine. Never round to a different number ("topped 160" for 164.7), project ("on pace for"), or state a number you can't ground; leave the number out. A single ungrounded number stops the whole run.`;

/** The rules for a piece written from the documents: what to rely on, and its sources, injuries, quotes, body, and numbers. */
export const SHARED_RULES = `Use only what the source snapshot says: the 49ers' schedule and results, the official injury report, and the documents. Never invent a stat, a result, an injury, or a quote.
${sourcesRule("at least one")}
${INJURIES_RULE}
${quotesRule()}
- body: Markdown paragraphs. No headings, no links in the body.
${NUMBERS_RULE}`;
