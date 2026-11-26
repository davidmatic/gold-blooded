// The publish pipeline's single entry point (Seam 1 in spec #1).
//
// publish() collects a source snapshot, asks the writer for drafts, turns them into content
// entries, and runs the job's publish checks. It never writes anything itself: a published
// result carries the entries for the caller to store, and a rejected one carries only the
// failures, so a rejected run leaves the content store untouched.
import { newsSummarySchema } from "../content/news-summary";
import type { PublishCheck } from "./checks/check";
import { sourceLinksResolve } from "./checks/source-links";
import type { CheckFailure, ContentEntry, DraftEntry, Job, JobType, PublishRequest, PublishResult } from "./types";

interface JobDefinition {
  checks: PublishCheck[];
}

// Later tickets add the other job types, more checks, and calendar resolution.
const JOBS: Partial<Record<JobType, JobDefinition>> = {
  "daily-news": { checks: [sourceLinksResolve] },
};

export async function publish(request: PublishRequest): Promise<PublishResult> {
  const definition = JOBS[request.job];
  if (!definition) throw new Error(`job type "${request.job}" is not implemented yet`);

  const job: Job = { type: request.job, date: request.date };
  const snapshot = await request.sources.collect(job);
  const drafts = await request.writer.write(job, snapshot);
  const entries: ContentEntry[] = [];
  const failures: CheckFailure[] = [];
  for (const draft of drafts) {
    const result = toEntry(draft, job);
    if ("entry" in result) entries.push(result.entry);
    else failures.push(result.failure);
  }

  const input = { job, entries, snapshot, sources: request.sources };
  failures.push(...(await Promise.all(definition.checks.map((check) => check(input)))).flat());
  return failures.length > 0 ? { status: "rejected", failures } : { status: "published", entries };
}

/** A draft becomes an entry only if it fits its content type's schema. */
function toEntry(draft: DraftEntry, job: Job): { entry: ContentEntry } | { failure: CheckFailure } {
  const title = typeof draft.data.title === "string" ? draft.data.title : "untitled";
  const path = `news/${job.date}-${slugify(title)}.md`;
  const parsed = newsSummarySchema.safeParse({ ...draft.data, date: job.date });
  if (!parsed.success) {
    const reason = parsed.error.issues.map((issue) => `${issue.path.join(".") || "draft"}: ${issue.message}`).join("; ");
    return { failure: { check: "schema", entry: path, reason } };
  }
  return { entry: { type: "news-summary", path, data: parsed.data, body: draft.body } };
}

function slugify(title: string): string {
  return title
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}
