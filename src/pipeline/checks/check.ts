import type { CheckFailure, ContentEntry, Job, SourceAdapter, SourceSnapshot } from "../types";

/** What every publish check sees: the run's drafts (as entries) and its source material. */
export interface CheckInput {
  job: Job;
  entries: ContentEntry[];
  snapshot: SourceSnapshot;
  sources: SourceAdapter;
}

/**
 * A publish check compares the drafts with the source snapshot and returns its failures
 * (none means it passed). Any failure from any check rejects the whole run.
 */
export type PublishCheck = (input: CheckInput) => Promise<CheckFailure[]>;

/** The source URLs an entry cites: its `sources`, and a Film Room entry's `link` to the original. */
export function citedUrls(entry: ContentEntry): string[] {
  const sources = ("sources" in entry.data && entry.data.sources) || [];
  return [...sources.map((source) => source.url), ...("link" in entry.data ? [entry.data.link] : [])];
}

/**
 * The prose this run wrote for an entry: its title and body, and its free-text fields (a Game
 * Preview's storylines and keys, a Stat Breakdown's trends, the Highlights' write-ups, an
 * Offseason document's notes, details, and profiles). For a running document, only the items
 * this update added or changed: the rest were checked when they were written.
 */
export function prose(entry: ContentEntry, snapshot: SourceSnapshot): string[] {
  const data = entry.data;
  const title = "title" in data && typeof data.title === "string" ? [data.title] : [];
  const fields = (() => {
    switch (entry.type) {
      case "game-preview":
        return [...entry.data.storylines, ...entry.data.keys];
      case "stat-breakdown":
        return entry.data.trends;
      case "highlights":
        return entry.data.standouts.map((standout) => standout.writeUp);
      case "free-agency-tracker": {
        const before = snapshot.current?.["free-agency-tracker"]?.data;
        return added(entry.data.moves, before?.moves).flatMap((move) => (move.detail ? [move.detail] : []));
      }
      case "draft-coverage": {
        const before = snapshot.current?.["draft-coverage"]?.data;
        return [...added(entry.data.teamNeeds, before?.teamNeeds).map((need) => need.note), ...added(entry.data.profiles, before?.profiles).map((profile) => profile.profile)];
      }
      default:
        return [];
    }
  })();
  // A running document whose body the update keeps (Reasons We Love Brock's introduction) has none of its own.
  const body = entry.type === "reasons-we-love-brock" ? [] : [entry.body];
  return [...title, ...body, ...fields];
}

/** The items of a running document's list that weren't in it as it stood. */
export function added<T>(items: readonly T[], before: readonly T[] | undefined): T[] {
  const kept = new Set((before ?? []).map(canonical));
  return items.filter((item) => !kept.has(canonical(item)));
}

/** The same item whatever order its keys are in (a hand-edited file may reorder them). */
export function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, field: unknown) =>
    field && typeof field === "object" && !Array.isArray(field) ? Object.fromEntries(Object.entries(field).sort(([a], [b]) => a.localeCompare(b))) : field,
  );
}
