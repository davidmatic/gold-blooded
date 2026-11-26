// CLI for the scheduled workflows: run one publish job and store its content.
//
//   npx tsx scripts/publish.ts <job> [--date YYYY-MM-DD] [--adapters fixture] [--content-dir content]
//
// Exits 0 on a published result (entries written under the content folder) and 1 on a
// rejected one (nothing written; each failed check is printed as a GitHub error annotation).
import { parseArgs } from "node:util";
import { fixtureAdapters } from "../src/pipeline/adapters/fixture";
import { runJob, type JobType } from "../src/pipeline";
import { contentDir } from "../src/site/content-dir";

const JOB_TYPES: readonly JobType[] = ["daily-news", "post-game", "thursday-preview", "film-room"];
const ADAPTERS = { fixture: fixtureAdapters } as const;

/** Today in the team's time zone, as YYYY-MM-DD. */
function teamToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" }).format(new Date());
}

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    date: { type: "string", default: teamToday() },
    adapters: { type: "string", default: "fixture" },
    "content-dir": { type: "string" },
  },
});

const job = positionals[0] as JobType;
if (!JOB_TYPES.includes(job)) throw new Error(`usage: publish.ts <${JOB_TYPES.join("|")}> [--date YYYY-MM-DD]`);
if (!/^\d{4}-\d{2}-\d{2}$/.test(values.date)) throw new Error(`--date must be YYYY-MM-DD, got ${values.date}`);
const makeAdapters = ADAPTERS[values.adapters as keyof typeof ADAPTERS];
if (!makeAdapters) throw new Error(`unknown --adapters "${values.adapters}" (known: ${Object.keys(ADAPTERS).join(", ")})`);

const result = await runJob({
  job,
  date: values.date,
  ...(await makeAdapters(job)),
  contentDir: values["content-dir"] ?? contentDir(),
});

if (result.status === "published") {
  console.log(`Published ${result.entries.length} entries for ${job} on ${values.date}:`);
  for (const entry of result.entries) console.log(`  ${entry.path}`);
} else {
  console.log(`Rejected ${job} on ${values.date}; nothing was written.`);
  for (const failure of result.failures) {
    console.log(`::error title=Publish check failed (${failure.check})::${failure.entry ?? job}: ${failure.reason}`);
  }
  process.exitCode = 1;
}
