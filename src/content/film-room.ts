// The Film Room entry content type (GLOSSARY.md): a short, credited summary of one QB School
// video or one Jonnydel's Football Academy episode, linking to the original. One Markdown file
// per entry under `content/film-room/`. The site's content collection and the publish pipeline
// both validate against this schema.
//
// The writer gives the title, the summary (the body), the link to the breakdown it summarises,
// whether it is about Brock Purdy, and any quotes. The pipeline fills in the rest from the source
// (the show, the medium, the original's title and date, and whether it was transcribed), so the
// writer can't credit the wrong show. A `purdy` tag is checked against the source and the body.
import { z } from "astro/zod";
import { isoDate, quote } from "./news-summary";

/** The shows the Film Room summarises (Preferred Sources in GLOSSARY.md). */
export const FILM_ROOM_SHOWS = ["The QB School", "Jonnydel's Football Academy"] as const;
export type FilmRoomShow = (typeof FILM_ROOM_SHOWS)[number];

/** A breakdown is a YouTube video or a podcast episode. */
export const FILM_ROOM_MEDIA = ["video", "podcast"] as const;
export type FilmRoomMedium = (typeof FILM_ROOM_MEDIA)[number];

export const filmRoomSchema = z
  .object({
    title: z.string().min(1),
    /** When the entry was written. */
    date: isoDate,
    show: z.enum(FILM_ROOM_SHOWS),
    medium: z.enum(FILM_ROOM_MEDIA),
    /** The original video or episode. */
    link: z.url({ protocol: /^https?$/ }),
    /** The original's own title. */
    sourceTitle: z.string().min(1),
    /** When the original was published (ISO 8601). */
    publishedAt: z.string().min(1),
    /**
     * Whether the summary was written from a transcript (captions or Whisper). False means only
     * the title and description were available, and the page says so.
     */
    transcribed: z.boolean(),
    /** About Brock Purdy: also shown in the Purdy Shrine. */
    purdy: z.boolean(),
    quotes: z.array(quote).optional(),
  })
  .superRefine((entry, ctx) => {
    entry.quotes?.forEach((q, i) => {
      if (q.source !== entry.link) ctx.addIssue({ code: "custom", path: ["quotes", i, "source"], message: "a quote must come from the breakdown the entry links to" });
    });
  });

export type FilmRoomData = z.infer<typeof filmRoomSchema>;
