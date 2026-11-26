// Publish check: every quote a piece uses must appear word for word in the text of the source
// document it cites. Pure: it reads only the entries and the snapshot.
//
// A quote is checked only if it is listed in the entry's `quotes`, so every quotation in the
// prose of a type that carries quotes must be listed there too. A quotation is any span in double
// quotes, curly (“…”) or straight ("…"), of two words or more: single quotes are left alone,
// since they are mostly apostrophes, and so is a scare-quoted single word (the “juice” package).
// A span is listed when, case and surrounding punctuation aside, it is part of a listed quote's
// text (a body may quote a fragment of the sentence the quote lists).
import type { ContentEntry, ContentType, CheckFailure } from "../types";
import { prose, type PublishCheck } from "./check";

/** The content types whose schema has `quotes`. */
const QUOTED_TYPES: ReadonlySet<ContentType> = new Set<ContentType>([
  "news-summary",
  "game-preview",
  "season-recap",
  "highlights",
  "love-letter",
  "film-room",
  "free-agency-tracker",
  "draft-coverage",
]);

export const quotesAreVerbatim: PublishCheck = async ({ entries, snapshot }) => {
  const texts = new Map(snapshot.documents.map((doc) => [doc.url, comparable(doc.text)]));
  return entries.flatMap((entry) => {
    const quotes = listedQuotes(entry);
    const unverified = quotes.flatMap((quote): CheckFailure[] => {
      const text = texts.get(quote.source);
      if (text?.includes(comparable(quote.text))) return [];
      return [{ check: "quotes", entry: entry.path, reason: `quote from ${quote.speaker} not found word for word in ${quote.source}: "${quote.text}"` }];
    });
    if (!QUOTED_TYPES.has(entry.type)) return unverified;
    const listed = quotes.map((quote) => bare(quote.text));
    const unlisted = prose(entry, snapshot)
      .flatMap(quotations)
      .filter((span) => !listed.some((text) => text.includes(bare(span))))
      .map((span): CheckFailure => ({ check: "quotes", entry: entry.path, reason: `the body quotes "${span}" but quotes doesn't list it, so it isn't checked word for word` }));
    return [...unverified, ...unlisted];
  });
};

function listedQuotes(entry: ContentEntry): { text: string; speaker: string; source: string }[] {
  return ("quotes" in entry.data && entry.data.quotes) || [];
}

/** The quotations in a piece of prose: double-quoted spans of two words or more. */
function quotations(text: string): string[] {
  return [...text.matchAll(/“([^“”]*)”|"([^"]*)"/g)].map((match) => (match[1] ?? match[2]!).trim()).filter((span) => /\S\s+\S/.test(span));
}

/**
 * Word for word, not byte for byte: line breaks and runs of spaces count as one space, and
 * curly quotes and apostrophes count as straight ones. Words, case, and punctuation must match.
 */
function comparable(text: string): string {
  return text.replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, " ").trim();
}

/** For finding a quotation among the listed quotes: case and the punctuation around it aside. */
function bare(text: string): string {
  return comparable(text)
    .toLowerCase()
    .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
}
