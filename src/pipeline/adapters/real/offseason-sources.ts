// The real sources for the Offseason job: the Thursday preview snapshot (the day's news from
// the Preferred Sources, the official injury report when there is one, and the nflverse
// schedule that places the date on the calendar), plus the Offseason's running documents as
// they stand in the content folder, so the writer updates them rather than starting over.
//
// A running document that fails its schema (a broken hand edit) fails the run, rather than
// being overwritten by an update that would lose it.
import { draftCoverageSchema, freeAgencyTrackerSchema, OFFSEASON_FILES, offseasonYear } from "../../../content/offseason";
import { readEntry } from "../../content-store";
import type { Job, SourceAdapter, SourceSnapshot } from "../../types";
import { previewSources } from "./preview-sources";
import type { FetchPage } from "./sources";

export interface OffseasonSourcesOptions {
  /** The content folder the running documents live in. */
  contentDir: string;
  fetchPage?: FetchPage;
  /** Collects the day's news and injury report. Defaults to the real news sources. */
  news?: SourceAdapter;
  log?: (message: string) => void;
}

const SCHEMAS = { "free-agency-tracker": freeAgencyTrackerSchema, "draft-coverage": draftCoverageSchema } as const;

export function offseasonSources(options: OffseasonSourcesOptions): SourceAdapter {
  const { contentDir, ...rest } = options;
  const preview = previewSources(rest);

  return {
    async collect(job: Job): Promise<SourceSnapshot> {
      const [snapshot, current] = await Promise.all([preview.collect(job), runningDocuments(contentDir, offseasonYear(job.date))]);
      return { ...snapshot, current };
    },
    linkResolves: (url) => preview.linkResolves(url),
  };
}

async function runningDocuments(contentDir: string, year: number): Promise<NonNullable<SourceSnapshot["current"]>> {
  const current: Record<string, { data: unknown; body: string }> = {};
  for (const type of Object.keys(SCHEMAS) as (keyof typeof SCHEMAS)[]) {
    const file = `offseason/${year}/${OFFSEASON_FILES[type]}`;
    const entry = await readEntry(contentDir, file);
    if (!entry) continue;
    const parsed = SCHEMAS[type].safeParse(entry.data);
    if (!parsed.success) {
      const reason = parsed.error.issues.map((issue) => `${issue.path.join(".") || "frontmatter"}: ${issue.message}`).join("; ");
      throw new Error(`${file} doesn't match its schema, so it can't be updated (fix the file): ${reason}`);
    }
    current[type] = { data: parsed.data, body: entry.body };
  }
  return current as NonNullable<SourceSnapshot["current"]>;
}
