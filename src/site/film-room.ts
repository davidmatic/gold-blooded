// How the Film Room reads on the site: its entries newest first, the newest on the homepage,
// and the Purdy-tagged ones as the Purdy Shrine lists them.
import type { FilmRoomData } from "../content/film-room";
import type { ShrineFilmRoomEntry } from "./purdy-shrine";
import { sitePath } from "./sections";

interface HasData {
  id: string;
  data: FilmRoomData;
  body?: string;
}

/** Newest first: by the day the entry was written, then by when the original came out. */
export function filmRoomNewestFirst<T extends HasData>(entries: readonly T[]): T[] {
  return [...entries].sort((a, b) => b.data.date.localeCompare(a.data.date) || b.data.publishedAt.localeCompare(a.data.publishedAt) || a.id.localeCompare(b.id));
}

/** The newest entry, for the homepage. */
export function newestFilmRoomEntry<T extends HasData>(entries: readonly T[]): T | undefined {
  return filmRoomNewestFirst(entries)[0];
}

/** The entry's anchor on the Film Room page. */
export function filmRoomAnchor(entry: HasData): string {
  return `film-room-${entry.id.replace(/[^A-Za-z0-9_-]/g, "-")}`;
}

/** "Watch the original" for a video, "Listen to the original" for an episode. */
export function originalLabel(data: FilmRoomData): string {
  return data.medium === "video" ? "Watch the original" : "Listen to the original";
}

/** Shown when the summary had only the title and description to go on. */
export function untranscribedNote(data: FilmRoomData): string | undefined {
  if (data.transcribed) return undefined;
  return data.medium === "video" ? "Written from the video's title and description." : "Written from the episode's title and show notes.";
}

/** The Purdy-tagged entries, newest first, as the Purdy Shrine lists them. */
export function shrineFilmRoom(entries: readonly HasData[]): ShrineFilmRoomEntry[] {
  return filmRoomNewestFirst(entries.filter((entry) => entry.data.purdy)).map((entry) => {
    const summary = firstParagraph(entry.body ?? "");
    return {
      title: entry.data.title,
      show: entry.data.show,
      href: `${sitePath("film-room")}#${filmRoomAnchor(entry)}`,
      sourceUrl: entry.data.link,
      date: entry.data.date,
      ...(summary && { summary }),
    };
  });
}

function firstParagraph(markdown: string): string {
  return (markdown.trim().split(/\n\s*\n/)[0] ?? "").replace(/[*_`]/g, "").replace(/\s+/g, " ").trim();
}
