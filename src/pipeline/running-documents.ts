// How an update to an Offseason running document is folded into the document as it stood.
//
// The writer returns only what is new or corrected this run (today's moves, the picks made so
// far, ...). Each list keeps every item it had, and an update item replaces the item with the
// same identity (a move is a player and a kind of move; a pick is its overall number; a profile
// and a mock draft, their player and their source). Team needs are a current view: a non-empty
// update replaces them. The document's `sources` become this update's sources plus every new
// item's source, so the source-link check covers each new link, and old links aren't rechecked.
//
// The draft is untrusted, so anything that isn't a list is passed through for the schema to reject.
import type { DraftCoverageData, FreeAgencyTrackerData } from "../content/offseason";

type Item = Record<string, unknown>;

export function mergeFreeAgencyTracker(draft: Record<string, unknown>, current?: FreeAgencyTrackerData): Record<string, unknown> {
  const moves = newestFirst(current?.moves, draft.moves, (move) => `${name(move.player)}|${move.kind}`);
  return { ...draft, moves, sources: updateSources(draft, [draft.moves]) };
}

export function mergeDraftCoverage(draft: Record<string, unknown>, current?: DraftCoverageData): Record<string, unknown> {
  const teamNeeds = Array.isArray(draft.teamNeeds) && draft.teamNeeds.length > 0 ? draft.teamNeeds : (current?.teamNeeds ?? draft.teamNeeds ?? []);
  const mockDrafts = newestFirst(current?.mockDrafts, draft.mockDrafts, (mock) => `${sourceUrl(mock)}`);
  const picks = inOrder(current?.picks, draft.picks, (pick) => String(pick.overall));
  if (Array.isArray(picks)) picks.sort((a, b) => Number((a as Item).overall) - Number((b as Item).overall));
  const profiles = inOrder(current?.profiles, draft.profiles, (profile) => name(profile.player));
  return { ...draft, teamNeeds, mockDrafts, picks, profiles, sources: updateSources(draft, [draft.mockDrafts, draft.picks, draft.profiles]) };
}

/** The update's items first, then the current items it doesn't replace. */
function newestFirst(current: readonly object[] | undefined, added: unknown, key: (item: Item) => string): unknown {
  if (added === undefined) return [...(current ?? [])];
  if (!Array.isArray(added)) return added;
  const replaced = new Set(added.filter(isItem).map(key));
  return [...added, ...(current ?? []).filter((item) => !replaced.has(key(item as Item)))];
}

/** The current items, with replaced ones updated in place, then the update's new items. */
function inOrder(current: readonly object[] | undefined, added: unknown, key: (item: Item) => string): unknown {
  if (added === undefined) return [...(current ?? [])];
  if (!Array.isArray(added)) return added;
  const updates = new Map(added.filter(isItem).map((item) => [key(item), item]));
  const kept = (current ?? []).map((item) => {
    const update = updates.get(key(item as Item));
    if (update) updates.delete(key(item as Item));
    return update ?? item;
  });
  return [...kept, ...added.filter((item) => !isItem(item) || updates.has(key(item)))];
}

function updateSources(draft: Record<string, unknown>, lists: unknown[]): unknown {
  if (draft.sources !== undefined && !Array.isArray(draft.sources)) return draft.sources;
  const all = [...((draft.sources as unknown[] | undefined) ?? []), ...lists.flatMap((list) => (Array.isArray(list) ? list.filter(isItem).map((item) => item.source) : []))];
  const seen = new Set<string>();
  return all.filter((source) => {
    const url = isItem(source) ? String(source.url) : JSON.stringify(source);
    if (seen.has(url)) return false;
    seen.add(url);
    return true;
  });
}

function isItem(value: unknown): value is Item {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sourceUrl(item: Item): string {
  return isItem(item.source) ? String(item.source.url) : "";
}

/** "Marcus Hale" and "marcus  hale" are the same player. */
function name(value: unknown): string {
  return String(value).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}
