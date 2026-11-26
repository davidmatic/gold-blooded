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
