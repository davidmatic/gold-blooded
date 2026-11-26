// The Offseason's running documents (GLOSSARY.md): the Free Agency Tracker and Draft Coverage.
// Each Offseason has one of each, updated by the Offseason job on every Offseason day rather
// than written once, in `content/offseason/<year>/`:
//
//   free-agency-tracker.md   signings, departures, and re-signings
//   draft-coverage.md        team needs, the mock draft roundup, the pick tracker, and profiles
//
// The year is the year of the Offseason's NFL Draft (the 2026 Offseason follows the 2025
// season). The lists keep every item ever added: the pipeline merges each run's new items into
// the document as it stood (see `src/pipeline/content-types.ts`), so a run can add or correct
// items but never silently drop one. To remove an item, edit the file.
//
// The site's content collections and the publish pipeline both validate against these schemas.
import { z } from "astro/zod";
import nflDrafts from "../../data/nfl-drafts.json";
import { injuryStatus, isoDate, quote } from "./news-summary";

export const OFFSEASON_FILES = { "free-agency-tracker": "free-agency-tracker.md", "draft-coverage": "draft-coverage.md" } as const;

const source = z.object({ url: z.url({ protocol: /^https?$/ }), outlet: z.string().min(1) });
const position = z.string().min(1);

export const FREE_AGENCY_MOVES = ["signing", "departure", "re-signing"] as const;

/** One roster move, linked to the source that reports it. */
export const freeAgencyMove = z.object({
  player: z.string().min(1),
  position,
  kind: z.enum(FREE_AGENCY_MOVES),
  /** When the move was reported. */
  date: isoDate,
  /** The terms, or where the player came from or went. */
  detail: z.string().optional(),
  source,
});
export type FreeAgencyMove = z.infer<typeof freeAgencyMove>;

const runningDocument = {
  title: z.string().min(1),
  /** The year of the Offseason (its NFL Draft's year). */
  offseason: z.number().int(),
  /** The date of the latest update. */
  updated: isoDate,
  /** What the latest update drew on. Each item keeps its own source link. */
  sources: z.array(source),
  /** Quotes the latest update uses, checked word for word like every piece's. */
  quotes: z.array(quote).optional(),
  /** Injury statuses the latest update states, checked against the official report. */
  injuries: z.array(injuryStatus).optional(),
};

export const freeAgencyTrackerSchema = z.object({
  ...runningDocument,
  /** Newest first. */
  moves: z.array(freeAgencyMove),
});
export type FreeAgencyTrackerData = z.infer<typeof freeAgencyTrackerSchema>;

const prospect = { player: z.string().min(1), position, school: z.string().min(1) };

/** One mock draft's projection for the 49ers' first pick. */
export const mockDraftPick = z.object({ ...prospect, pick: z.number().int().positive(), source });
/** A 49ers pick on draft day. */
export const draftPick = z.object({
  ...prospect,
  round: z.number().int().min(1).max(7),
  overall: z.number().int().positive(),
  source,
});
/** A profile of a player the 49ers drafted. */
export const draftProfile = z.object({ ...prospect, profile: z.string().min(1), source });

export const draftCoverageSchema = z.object({
  ...runningDocument,
  /** The NFL Draft's first and last day. */
  draft: z.object({ start: isoDate, end: isoDate }),
  teamNeeds: z.array(z.object({ position, note: z.string().min(1) })),
  mockDrafts: z.array(mockDraftPick),
  /** In draft order. */
  picks: z.array(draftPick),
  profiles: z.array(draftProfile),
});
export type DraftCoverageData = z.infer<typeof draftCoverageSchema>;

export interface DraftDates {
  start: string;
  end: string;
}

/**
 * The year's NFL Draft, from `data/nfl-drafts.json`. A year not listed there is estimated as
 * the fourth Thursday of April through the Saturday after, which the draft has kept to since 2022.
 */
export function draftDates(year: number): DraftDates {
  const listed = (nflDrafts.drafts as Record<string, DraftDates | undefined>)[String(year)];
  if (listed) return listed;
  const firstOfApril = new Date(Date.UTC(year, 3, 1));
  const firstThursday = 1 + ((4 - firstOfApril.getUTCDay() + 7) % 7);
  const start = new Date(Date.UTC(year, 3, firstThursday + 21));
  return { start: isoDay(start), end: isoDay(addDays(start, 2)) };
}

/**
 * Whether Draft Coverage leads the homepage on a date, instead of the Free Agency Tracker:
 * from `daysBefore` days before the draft's first day through `daysAfter` days after its last
 * (`homepageWindow` in `data/nfl-drafts.json`).
 */
export function draftCoverageLeads(date: string, draft: DraftDates): boolean {
  const { daysBefore, daysAfter } = nflDrafts.homepageWindow;
  const from = isoDay(addDays(parseDay(draft.start), -daysBefore));
  const until = isoDay(addDays(parseDay(draft.end), daysAfter));
  return date >= from && date <= until;
}

function parseDay(day: string): Date {
  return new Date(`${day}T00:00:00Z`);
}

function addDays(day: Date, days: number): Date {
  return new Date(day.getTime() + days * 86_400_000);
}

function isoDay(day: Date): string {
  return day.toISOString().slice(0, 10);
}

/** The Offseason a date belongs to, by its NFL Draft's year: every Offseason day falls in that year. */
export function offseasonYear(date: string): number {
  return Number(date.slice(0, 4));
}
