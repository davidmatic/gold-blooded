// The publish pipeline's single entry point (Seam 1 in spec #1).
//
// publish() collects a source snapshot, works out what the job writes on its date (for
// calendar jobs, from where the date falls in the 49ers' schedule), asks the writer for those
// drafts, turns them into content entries, and runs the job's publish checks. It never writes
// anything itself: a published result carries the entries for the caller to store, and a
// rejected one carries only the failures, so a rejected run leaves the content store untouched.
import { resolveCalendar, type CalendarPosition } from "./calendar";
import type { PublishCheck } from "./checks/check";
import { injuryStatusesMatch } from "./checks/injury-status";
import { quotesAreVerbatim } from "./checks/quotes";
import { podcastsAttributed } from "./checks/podcast-attribution";
import { statsMatchNflverse } from "./checks/nflverse-stats";
import { sourceLinksResolve } from "./checks/source-links";
import { offseasonItemsSourced } from "./checks/offseason-items";
import { CONTENT_TYPES } from "./content-types";
import type {
  CheckFailure,
  ContentEntry,
  ContentType,
  DraftEntry,
  Job,
  JobType,
  PublishRequest,
  PublishResult,
  SourceSnapshot,
} from "./types";

interface JobDefinition {
  checks: PublishCheck[];
  /**
   * What the job writes: always the same content types, or a choice made from where the date
   * falls on the calendar. An empty choice means the job has nothing to do that day.
   */
  writes: ContentType[] | ((calendar: CalendarPosition) => ContentType[]);
}

const ALL_CHECKS = [sourceLinksResolve, injuryStatusesMatch, quotesAreVerbatim, podcastsAttributed, statsMatchNflverse];

// Later tickets add the other job types and more checks.
const JOBS: Partial<Record<JobType, JobDefinition>> = {
  "daily-news": { checks: ALL_CHECKS, writes: ["news-summary"] },
  // A Game Preview and a Stat Breakdown in a Game Week, a season recap in a Bye Week, nothing
  // in the Offseason.
  "thursday-preview": {
    checks: ALL_CHECKS,
    writes: (calendar) =>
      calendar.period === "game-week" ? ["game-preview", "stat-breakdown"] : calendar.period === "bye-week" ? ["season-recap"] : [],
  },
  // The Offseason's running documents, updated every Offseason day; nothing in the season.
  offseason: {
    checks: [...ALL_CHECKS, offseasonItemsSourced],
    writes: (calendar) => (calendar.period === "offseason" ? ["free-agency-tracker", "draft-coverage"] : []),
  },
};

export async function publish(request: PublishRequest): Promise<PublishResult> {
  const definition = JOBS[request.job];
  if (!definition) throw new Error(`job type "${request.job}" is not implemented yet`);

  const snapshot = await request.sources.collect({ type: request.job, date: request.date });
  const job = assign(request, definition, snapshot);
  if (job.contentTypes!.length === 0) return { status: "published", entries: [] };

  const drafts = await request.writer.write(job, snapshot);
  const entries: ContentEntry[] = [];
  const failures: CheckFailure[] = [];
  for (const draft of drafts) {
    const result = toEntry(draft, job, snapshot);
    if ("entry" in result) entries.push(result.entry);
    else failures.push(result.failure);
  }
  failures.push(...missingContent(job, drafts));

  const input = { job, entries, snapshot, sources: request.sources };
  failures.push(...(await Promise.all(definition.checks.map((check) => check(input)))).flat());
  return failures.length > 0 ? { status: "rejected", failures } : { status: "published", entries };
}

/** The job as the writer sees it: what to write, and for calendar jobs, where the date falls. */
function assign(request: PublishRequest, definition: JobDefinition, snapshot: SourceSnapshot): Job {
  const job: Job = { type: request.job, date: request.date };
  if (Array.isArray(definition.writes)) return { ...job, contentTypes: definition.writes };
  if (!snapshot.schedule) throw new Error(`the ${request.job} job needs the 49ers schedule, and the source snapshot has none`);
  const calendar = resolveCalendar(request.date, snapshot.schedule);
  return { ...job, calendar, contentTypes: definition.writes(calendar) };
}

/** A draft becomes an entry only if the job asked for its type and it fits the type's schema. */
function toEntry(draft: DraftEntry, job: Job, snapshot: SourceSnapshot): { entry: ContentEntry } | { failure: CheckFailure } {
  if (!job.contentTypes!.includes(draft.type)) {
    return { failure: { check: "schema", entry: draft.type, reason: `the ${job.type} job doesn't write a ${draft.type} on ${job.date}` } };
  }
  const definition = CONTENT_TYPES[draft.type];
  const data = { ...(definition.merge ? definition.merge(draft.data, snapshot) : draft.data), ...definition.owned(job, snapshot) };
  const path = definition.path(data, job);
  const parsed = definition.schema.safeParse(data);
  if (!parsed.success) {
    const reason = parsed.error.issues.map((issue) => `${issue.path.join(".") || "draft"}: ${issue.message}`).join("; ");
    return { failure: { check: "schema", entry: path, reason } };
  }
  return { entry: { type: draft.type, path, data: parsed.data, body: draft.body } as ContentEntry };
}

/** A content type a run writes exactly one of must be there exactly once. */
function missingContent(job: Job, drafts: DraftEntry[]): CheckFailure[] {
  return job.contentTypes!.flatMap((type) => {
    const count = drafts.filter((draft) => draft.type === type).length;
    if (!CONTENT_TYPES[type].single || count === 1) return [];
    return [{ check: "schema", entry: type, reason: `the ${job.type} job writes exactly one ${type}, and the writer returned ${count}` }];
  });
}
