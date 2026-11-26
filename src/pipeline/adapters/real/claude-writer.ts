// The real content writer: asks Claude to turn a source snapshot into News Summaries.
//
// It uses structured output (a Zod schema) so the reply always has the News Summary shape;
// the pipeline still validates every draft against the content schema and runs the publish
// checks, so nothing Claude writes is trusted until it passes them.
// The request itself (retries, the spend limit) is the shared one in ./claude.ts.
import { z } from "zod";
import { GAME_STATUSES, NEWS_CATEGORIES, PRACTICE_STATUSES } from "../../../content/news-summary";
import type { ContentWriter, DraftEntry, Job, SourceSnapshot } from "../../types";
import { claudeAsker, type ClaudeOptions } from "./claude";
import { NUMBERS_RULE } from "./writer-output";

/** What Claude returns. Lists are always present (possibly empty) and unset statuses are null. */
const writerOutputSchema = z.object({
  summaries: z.array(
    z.object({
      category: z.enum(NEWS_CATEGORIES),
      title: z.string(),
      body: z.string(),
      sources: z.array(z.object({ url: z.string(), outlet: z.string() })),
      injuries: z.array(
        z.object({
          player: z.string(),
          practiceStatus: z.enum(PRACTICE_STATUSES).nullable(),
          gameStatus: z.enum(GAME_STATUSES).nullable(),
        }),
      ),
      quotes: z.array(z.object({ text: z.string(), speaker: z.string(), source: z.string() })),
    }),
  ),
});
export type WriterOutput = z.infer<typeof writerOutputSchema>;

/** The neutral news voice. Stable text, so it is cached across runs. */
export const NEWS_VOICE = `You write the daily News Summaries for Gold Blooded, an unofficial, non-commercial San Francisco 49ers fan site.

Voice: neutral, factual, and brief, like a good wire service. Write in the site's own words; never copy a source's sentences except inside a quote. No hype, no speculation, no rumours presented as fact. Opinions from a named person are attributed to them ("On 49ers Talk, Maiocco says..."). The Purdy Shrine has its own voice elsewhere; news stays neutral.

You are given a source snapshot: the official 49ers injury report (structured, and as a document), and today's documents from Preferred Sources (49ers.com news, transactions, and press conference transcripts; NBC Sports Bay Area; ESPN; the San Francisco Chronicle; podcast episode transcripts). Use only what the documents say.

Write one News Summary per piece of recent team news worth a fan's attention. Skip items that are not news (power rankings, betting odds, fashion, promotions). Merge documents that report the same news into one summary that cites all of them. Each summary:
- category: exactly one of "Injury", "Personnel" (signings, releases, trades, roster moves, contracts, front office), "Practice Report" (who practised, how practice went), or "Coach's Comments" (what a coach or coordinator said).
- title: a short, plain headline in sentence case.
- body: 1 to 3 short paragraphs of Markdown. No headings, no links in the body.
- sources: every document the summary relies on, each with its exact "url" and its "outlet" as given in the snapshot. Never invent or alter a URL. At least one source.
- injuries: for every player whose practice participation or game status the body states, one entry with the player's name exactly as it appears in the official injury report, and practiceStatus (DNP, LP, FP) and/or gameStatus (Out, Doubtful, Questionable) exactly as the official report gives them; null for any status you don't state. Only state injury statuses that the official injury report in the snapshot gives. An Injury summary must list at least one injury. If the report has no game status for a player yet, do not give one. A summary whose body mentions an injury at all (injury, hurt, questionable, doubtful, injured reserve, a sprain, surgery, ...) must list the status the official report gives; if the report doesn't list the player, leave the injury out of the body.
- quotes: every quotation that appears in the body, without exception (any words in double quotation marks count). Each entry has the quoted words in "text", the "speaker", and in "source" the url of the document where those exact words appear (one of the summary's sources). A quote must be copied word for word, character for character, from that document's text: no paraphrase, no fixing grammar, no joining sentences that are apart, no ellipses. Keep quotes short (one or two sentences). If you cannot quote exactly, paraphrase without quotation marks instead.

Podcast transcripts: some documents are machine transcripts of podcast episodes (49ers Talk, Jonnydel's Football Academy), marked "podcast transcript" with the show and its hosts. A podcast is opinion and analysis, not official news: never present a host's take as fact. Every summary that cites an episode must, in its body, name the show exactly as given and the host whose view it is, by name or surname (e.g. "On 49ers Talk, Maiocco says..." or "On Jonnydel's Football Academy, Jonnydel argues..."), and must list the episode's url as a source. Write podcast takes as their own summaries, categorised by what they discuss (e.g. a host's view of a practice report is "Practice Report"). The transcript is automatic and may misspell names or garble words: quote it only where its exact text reads cleanly, copying it character for character, otherwise paraphrase. Skip ads, sponsor reads, and banter.

${NUMBERS_RULE}

Coach's Comments should quote the coach briefly and exactly, with attribution. If there is no real news, return an empty list of summaries.`;

/** The snapshot as the user turn: the structured injury report, then each document in full. */
export function renderSnapshot(job: Job, snapshot: SourceSnapshot): string {
  const parts = [
    `Job: daily news for ${job.date} (team-local date).`,
    `Official injury report (structured): ${snapshot.injuryReport ? JSON.stringify(snapshot.injuryReport) : "not available"}`,
    `Documents (${snapshot.documents.length}):`,
    ...snapshot.documents.map((doc, i) =>
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
  return parts.join("\n\n");
}

/** Claude's structured output as pipeline drafts: empty lists and null statuses dropped. */
export function toDraftEntries(output: WriterOutput): DraftEntry[] {
  return output.summaries.map((summary) => {
    const injuries = summary.injuries.map(({ player, practiceStatus, gameStatus }) => ({
      player,
      ...(practiceStatus && { practiceStatus }),
      ...(gameStatus && { gameStatus }),
    }));
    return {
      type: "news-summary",
      data: {
        title: summary.title,
        category: summary.category,
        sources: summary.sources,
        ...(injuries.length > 0 && { injuries }),
        ...(summary.quotes.length > 0 && { quotes: summary.quotes }),
      },
      body: summary.body,
    };
  });
}

export type ClaudeWriterOptions = ClaudeOptions;

export function claudeWriter(options: ClaudeWriterOptions = {}): ContentWriter {
  const ask = claudeAsker(options);
  return {
    async write(job, snapshot) {
      if (job.type !== "daily-news") throw new Error(`the Claude writer doesn't write "${job.type}" yet`);
      return toDraftEntries(await ask(NEWS_VOICE, writerOutputSchema, renderSnapshot(job, snapshot)));
    },
  };
}
