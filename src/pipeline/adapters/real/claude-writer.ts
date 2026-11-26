// The real content writer: asks Claude to turn a source snapshot into News Summaries.
//
// It uses structured output (a Zod schema) so the reply always has the News Summary shape;
// the pipeline still validates every draft against the content schema and runs the publish
// checks, so nothing Claude writes is trusted until it passes them.
// The request itself (retries, the spend limit) is the shared one in ./claude.ts.
import { z } from "zod";
import { NEWS_CATEGORIES } from "../../../content/news-summary";
import type { ContentWriter, DraftEntry, Job, SourceSnapshot } from "../../types";
import { claudeAsker, ROUTINE_MODEL, type ClaudeOptions } from "./claude";
import { INJURIES_RULE, injuriesField, injuriesOutput, NUMBERS_RULE, quotesField, quotesOutput, quotesRule, renderDocuments, sourcesOutput, sourcesRule } from "./writer-output";

/** What Claude returns. Lists are always present (possibly empty) and unset statuses are null. */
const writerOutputSchema = z.object({
  summaries: z.array(
    z.object({
      category: z.enum(NEWS_CATEGORIES),
      title: z.string(),
      body: z.string(),
      sources: sourcesOutput,
      injuries: injuriesOutput,
      quotes: quotesOutput,
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
${sourcesRule("at least one")}
${INJURIES_RULE} An Injury summary must list at least one injury. A summary whose body mentions an injury at all (injury, hurt, questionable, doubtful, injured reserve, a sprain, surgery, ...) must list the status the official report gives; if the report doesn't list the player, leave the injury out of the body.
${quotesRule("the url of the document where those exact words appear (one of the summary's sources)")}

Podcast transcripts: some documents are machine transcripts of podcast episodes (49ers Talk, Jonnydel's Football Academy), marked "podcast transcript" with the show and its hosts. A podcast is opinion and analysis, not official news: never present a host's take as fact. Every summary that cites an episode must, in its body, name the show exactly as given and the host whose view it is, by name or surname (e.g. "On 49ers Talk, Maiocco says..." or "On Jonnydel's Football Academy, Jonnydel argues..."), and must list the episode's url as a source. Write podcast takes as their own summaries, categorised by what they discuss (e.g. a host's view of a practice report is "Practice Report"). The transcript is automatic and may misspell names or garble words: quote it only where its exact text reads cleanly, copying it character for character, otherwise paraphrase. Skip ads, sponsor reads, and banter.

${NUMBERS_RULE}

Coach's Comments should quote the coach briefly and exactly, with attribution. If there is no real news, return an empty list of summaries.`;

/** The snapshot as the user turn: the structured injury report, then each document in full. */
export function renderSnapshot(job: Job, snapshot: SourceSnapshot): string {
  const parts = [
    `Job: daily news for ${job.date} (team-local date).`,
    `Official injury report (structured): ${snapshot.injuryReport ? JSON.stringify(snapshot.injuryReport) : "not available"}`,
    ...renderDocuments(snapshot.documents),
  ];
  return parts.join("\n\n");
}

/** Claude's structured output as pipeline drafts: empty lists and null statuses dropped. */
export function toDraftEntries(output: WriterOutput): DraftEntry[] {
  return output.summaries.map((summary) => ({
    type: "news-summary",
    data: {
      title: summary.title,
      category: summary.category,
      sources: summary.sources,
      ...injuriesField(summary.injuries),
      ...quotesField(summary.quotes),
    },
    body: summary.body,
  }));
}

export function claudeWriter(options: ClaudeOptions = {}): ContentWriter {
  const ask = claudeAsker({ model: ROUTINE_MODEL, ...options });
  return {
    async write(job, snapshot) {
      return toDraftEntries(await ask(NEWS_VOICE, writerOutputSchema, renderSnapshot(job, snapshot)));
    },
  };
}
