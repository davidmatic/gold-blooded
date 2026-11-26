// Publish check: every item an update adds to an Offseason running document (a free agency
// move, a mock draft projection, a draft pick, a player profile) must cite a document in the
// source snapshot that names the player. Items already in the document as it stood aren't
// rechecked: their sources were checked when they were added. Pure: it reads only the entries
// and the snapshot.
import type { CheckFailure, ContentEntry, SourceSnapshot } from "../types";
import type { PublishCheck } from "./check";

interface SourcedItem {
  player: string;
  source: { url: string };
}

const LISTS = {
  "free-agency-tracker": ["moves"],
  "draft-coverage": ["mockDrafts", "picks", "profiles"],
} as const;

export const offseasonItemsSourced: PublishCheck = async ({ entries, snapshot }) => {
  const texts = new Map(snapshot.documents.map((doc) => [doc.url, comparable(doc.text)]));
  return entries.flatMap((entry): CheckFailure[] => {
    if (entry.type !== "free-agency-tracker" && entry.type !== "draft-coverage") return [];
    return LISTS[entry.type].flatMap((list) =>
      newItems(entry, list, snapshot).flatMap((item): CheckFailure[] => {
        const fail = (reason: string) => [{ check: "offseason-sources", entry: entry.path, reason: `${item.player} (${list}): ${reason}` }];
        const text = texts.get(item.source.url);
        if (text === undefined) return fail(`the cited source ${item.source.url} is not in the source snapshot`);
        return text.includes(comparable(item.player)) ? [] : fail(`not named in the cited source ${item.source.url}`);
      }),
    );
  });
};

function newItems(entry: ContentEntry, list: string, snapshot: SourceSnapshot): SourcedItem[] {
  const current = snapshot.current?.[entry.type as keyof typeof LISTS]?.data as Record<string, unknown> | undefined;
  const before = new Set(((current?.[list] as unknown[] | undefined) ?? []).map(canonical));
  const items = (entry.data as unknown as Record<string, SourcedItem[]>)[list] ?? [];
  return items.filter((item) => !before.has(canonical(item)));
}

/** The same item whatever order its keys are in (a hand-edited file may reorder them). */
function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, field: unknown) =>
    field && typeof field === "object" && !Array.isArray(field) ? Object.fromEntries(Object.entries(field).sort(([a], [b]) => a.localeCompare(b))) : field,
  );
}

function comparable(text: string): string {
  return text.normalize("NFKD").replace(/[‘’]/g, "'").replace(/\s+/g, " ").toLowerCase();
}
