// Offseason mode on the site: which running documents are current, and what the homepage's
// Game Preview slot shows in the Offseason.
import type { GamePreviewData } from "../content/game-week";
import { draftCoverageLeads, type DraftCoverageData, type FreeAgencyTrackerData } from "../content/offseason";

interface HasData<T> {
  id: string;
  data: T;
}

/** The newest Offseason's document of a kind (the one with the latest year). */
export function currentDocument<T extends HasData<{ offseason: number }>>(documents: readonly T[]): T | undefined {
  return [...documents].sort((a, b) => b.data.offseason - a.data.offseason)[0];
}

export type OffseasonLead<F, D> = { kind: "free-agency-tracker"; entry: F; other?: D } | { kind: "draft-coverage"; entry: D; other?: F };

/**
 * What leads the homepage in the Offseason, or nothing when game content is current.
 *
 * The Offseason job updates the running documents every Offseason day and stops when the
 * season's first Game Week begins, so the latest update date stands for "today" in the
 * Offseason. The slot is the Offseason's while that update is newer than the latest Game
 * Preview; it goes back to the Game Preview once the season's first one is published.
 * Draft Coverage leads around the draft (the window in `data/nfl-drafts.json`), and the Free
 * Agency Tracker the rest of the Offseason.
 */
export function offseasonLead<F extends HasData<FreeAgencyTrackerData>, D extends HasData<DraftCoverageData>, P extends HasData<GamePreviewData>>(
  trackers: readonly F[],
  coverage: readonly D[],
  previews: readonly P[],
): OffseasonLead<F, D> | undefined {
  const year = Math.max(...[...trackers, ...coverage].map((doc) => doc.data.offseason));
  const tracker = trackers.find((doc) => doc.data.offseason === year);
  const draft = coverage.find((doc) => doc.data.offseason === year);
  if (!tracker && !draft) return undefined;

  const today = [tracker?.data.updated, draft?.data.updated].filter((day): day is string => !!day).sort().at(-1)!;
  const latestPreview = previews.map((preview) => preview.data.date).sort().at(-1);
  if (latestPreview && latestPreview >= today) return undefined;

  if (draft && (!tracker || draftCoverageLeads(today, draft.data.draft))) return { kind: "draft-coverage", entry: draft, ...(tracker && { other: tracker }) };
  return { kind: "free-agency-tracker", entry: tracker!, ...(draft && { other: draft }) };
}

const MOVE_LABELS = { signing: "Signing", departure: "Departure", "re-signing": "Re-signing" } as const;

/** "Signing", "Departure", "Re-signing". */
export function moveLabel(kind: keyof typeof MOVE_LABELS): string {
  return MOVE_LABELS[kind];
}

const dayFormat = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "long", day: "numeric" });

/** "April 23 to 25", or "April 30 to May 2". */
export function formatDraftDates(draft: { start: string; end: string }): string {
  const [start, end] = [draft.start, draft.end].map((day) => dayFormat.format(new Date(`${day}T00:00:00Z`)));
  const sameMonth = start!.split(" ")[0] === end!.split(" ")[0];
  return `${start} to ${sameMonth ? end!.split(" ")[1] : end}`;
}

/** "March 12", for "Updated March 12". */
export function formatDay(day: string): string {
  return dayFormat.format(new Date(`${day}T00:00:00Z`));
}
