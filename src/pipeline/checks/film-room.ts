// Publish checks for the Film Room. Pure: they read only the entries and the snapshot.
import type { CheckFailure, ContentEntry } from "../types";
import type { PublishCheck } from "./check";

type FilmRoomEntry = Extract<ContentEntry, { type: "film-room" }>;

function filmRoomEntries(entries: ContentEntry[]): FilmRoomEntry[] {
  return entries.filter((entry): entry is FilmRoomEntry => entry.type === "film-room");
}

/**
 * Every breakdown in the snapshot gets exactly one entry, so a new video or episode always
 * appears, with its title, description, and link when nothing else could be had.
 */
export const filmRoomCovered: PublishCheck = async ({ entries, snapshot }) => {
  const film = filmRoomEntries(entries);
  return snapshot.documents.flatMap((doc): CheckFailure[] => {
    if (!doc.film) return [];
    const count = film.filter((entry) => entry.data.link === doc.url).length;
    if (count === 1) return [];
    const has = count === 0 ? "has no Film Room entry" : `has ${count} Film Room entries`;
    return [{ check: "film-room-coverage", entry: doc.url, reason: `${doc.film.show}'s "${doc.title}" ${has}` }];
  });
};

const PURDY = /\bpurdy\b/i;

/**
 * An entry tagged as about Brock Purdy (and so shown in the Purdy Shrine) must be grounded: the
 * breakdown it summarises (its title, description, or transcript) and its own summary must both
 * mention him.
 */
export const purdyTagGrounded: PublishCheck = async ({ entries, snapshot }) => {
  const sources = new Map(snapshot.documents.map((doc) => [doc.url, doc]));
  return filmRoomEntries(entries).flatMap((entry): CheckFailure[] => {
    if (!entry.data.purdy) return [];
    const source = sources.get(entry.data.link);
    const fail = (reason: string): CheckFailure[] => [{ check: "film-room-purdy", entry: entry.path, reason: `tagged as about Brock Purdy, but ${reason}` }];
    if (!PURDY.test([source?.title, source?.film?.description, source?.text].join("\n"))) return fail(`its source (${entry.data.link}) never mentions Purdy`);
    if (!PURDY.test(`${entry.data.title}\n${entry.body}`)) return fail("its summary never mentions Purdy");
    return [];
  });
};
