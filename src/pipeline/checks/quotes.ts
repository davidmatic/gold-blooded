// Publish check: every quote a News Summary uses must appear word for word in the text of
// the source document it cites. Pure: it reads only the entries and the snapshot.
import type { CheckFailure } from "../types";
import type { PublishCheck } from "./check";

export const quotesAreVerbatim: PublishCheck = async ({ entries, snapshot }) => {
  const texts = new Map(snapshot.documents.map((doc) => [doc.url, comparable(doc.text)]));
  return entries.flatMap((entry) =>
    (entry.data.quotes ?? []).flatMap((quote): CheckFailure[] => {
      const text = texts.get(quote.source);
      if (text?.includes(comparable(quote.text))) return [];
      return [
        {
          check: "quotes",
          entry: entry.path,
          reason: `quote from ${quote.speaker} not found word for word in ${quote.source}: "${quote.text}"`,
        },
      ];
    }),
  );
};

/**
 * Word for word, not byte for byte: line breaks and runs of spaces count as one space, and
 * curly quotes and apostrophes count as straight ones. Words, case, and punctuation must match.
 */
function comparable(text: string): string {
  return text.replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, " ").trim();
}
