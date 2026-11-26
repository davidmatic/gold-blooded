// The real content writer for the Film Room job: asks Claude, once per run, for one short,
// credited entry per new breakdown. With no new breakdowns it writes nothing and asks nothing.
//
// The pipeline fills in what each entry says about its source (show, medium, the original's
// title and date, whether it was transcribed), runs every publish check, and holds a Purdy tag
// to the source and the summary, so nothing Claude writes is trusted.
import { z } from "zod";
import type { ContentWriter, DraftEntry, Job, SourceSnapshot } from "../../types";
import { claudeAsker, type ClaudeOptions } from "./claude";
import { NUMBERS_RULE, quotesField, quotesOutput, quotesRule } from "./writer-output";

const filmRoomOutputSchema = z.object({
  entries: z.array(
    z.object({
      link: z.string(),
      title: z.string(),
      body: z.string(),
      purdy: z.boolean(),
      quotes: quotesOutput,
    }),
  ),
});
export type FilmRoomOutput = z.infer<typeof filmRoomOutputSchema>;

/** The Film Room voice. Stable text, so it is cached across runs. */
export const FILM_ROOM_VOICE = `You write the Film Room for Gold Blooded, an unofficial, non-commercial San Francisco 49ers fan site: short, credited summaries of other analysts' film breakdowns, from The QB School (YouTube) and Jonnydel's Football Academy (a podcast), each linking to the original.

Voice: a knowledgeable 49ers fan pointing other fans to good film work. The analysis is the analyst's, never ours: credit every take to the show ("The QB School shows...", "On Jonnydel's Football Academy, Jonnydel argues..."). Never present a take as fact, and never add analysis the breakdown doesn't make.

You are given each new breakdown: its url, show, title, publish date, description, and its text. The text is a machine transcript (YouTube captions or Whisper), which may misspell names and garble words, or, when no transcript could be had, only the title and description. Write exactly one entry per breakdown, even one with only a title and description; then keep it to what the title and description say, and don't pretend to have watched it.

Each entry:
- link: the breakdown's exact url, as given. Never invent or alter a URL.
- title: a short, plain headline in sentence case, in our own words.
- body: one or two short paragraphs of Markdown: what the breakdown covers and its main points. No headings, no links. Name the show in the body. For a Jonnydel's Football Academy episode, also name Jonnydel.
- purdy: true only when the breakdown is substantially about Brock Purdy (his play, his throws, his decisions), and then the title or body must name him. A passing mention is not enough.
${quotesRule("the entry's link")} Quote only from a transcript, and only where it reads cleanly; never quote a description.
${NUMBERS_RULE}

Skip ads, sponsor reads, and banter.`;

/** The breakdowns as the user turn. */
export function renderFilmRoomBrief(job: Job, snapshot: SourceSnapshot): string {
  const breakdowns = snapshot.documents.filter((doc) => doc.film);
  return [
    `Job: the Film Room for ${job.date} (team-local date). New breakdowns: ${breakdowns.length}.`,
    ...breakdowns.map((doc, i) =>
      [
        `<breakdown index="${i + 1}">`,
        `url: ${doc.url}`,
        `show: ${doc.film!.show} (${doc.film!.medium})`,
        ...(doc.podcast ? [`hosts: ${doc.podcast.hosts.join(", ")}`] : []),
        `title: ${doc.title}`,
        `published: ${doc.publishedAt}`,
        `description: ${doc.film!.description || "none"}`,
        doc.film!.transcribed ? "text (machine transcript):" : "text: title and description only (no transcript could be had)",
        ...(doc.film!.transcribed ? [doc.text] : []),
        "</breakdown>",
      ].join("\n"),
    ),
  ].join("\n\n");
}

/** Claude's structured output as pipeline drafts, empty quote lists dropped. */
export function toFilmRoomDrafts(output: FilmRoomOutput): DraftEntry[] {
  return output.entries.map((entry) => ({
    type: "film-room",
    data: { link: entry.link, title: entry.title, purdy: entry.purdy, ...quotesField(entry.quotes) },
    body: entry.body,
  }));
}

export function claudeFilmRoomWriter(options: ClaudeOptions = {}): ContentWriter {
  const ask = claudeAsker(options);
  return {
    async write(job, snapshot) {
      if (job.type !== "film-room") throw new Error(`the Claude Film Room writer doesn't write "${job.type}"`);
      if (!snapshot.documents.some((doc) => doc.film)) return [];
      return toFilmRoomDrafts(await ask(FILM_ROOM_VOICE, filmRoomOutputSchema, renderFilmRoomBrief(job, snapshot)));
    },
  };
}
