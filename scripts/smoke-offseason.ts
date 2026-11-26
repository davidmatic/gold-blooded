// Manual smoke test for the real Offseason adapters. Not run by `npm test`: it uses the network,
// and with --claude it calls the Claude API (a few cents per run).
//
//   npx tsx scripts/smoke-offseason.ts [--date YYYY-MM-DD]            # sources + calendar, no API key
//   npx tsx scripts/smoke-offseason.ts --claude [--date YYYY-MM-DD]   # + Claude writer and publish checks
//
// Sources only: fetches the nflverse schedule and the day's Preferred Sources, reads the running
// documents from the content folder (or --content-dir), and prints where the date falls. With
// --claude: runs publish() end to end and prints the updated documents or the failed checks. It
// never writes to the content folder; pass --out <dir> to have the entries written there.
import { parseArgs } from "node:util";
import { draftDates, offseasonYear } from "../src/content/offseason";
import { publish } from "../src/pipeline";
import { claudeOffseasonWriter, offseasonSources } from "../src/pipeline/adapters/real";
import { resolveCalendar } from "../src/pipeline/calendar";
import { writeEntries } from "../src/pipeline/content-store";
import { contentDir } from "../src/site/content-dir";

const { values } = parseArgs({
  options: {
    date: { type: "string", default: new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" }).format(new Date()) },
    claude: { type: "boolean", default: false },
    out: { type: "string" },
    "content-dir": { type: "string" },
  },
});

const job = { type: "offseason" as const, date: values.date };
const sources = offseasonSources({ contentDir: values["content-dir"] ?? contentDir(), log: (message) => console.log(`  [sources] ${message}`) });

if (!values.claude) {
  const snapshot = await sources.collect(job);
  const calendar = resolveCalendar(job.date, snapshot.schedule ?? []);
  const draft = draftDates(offseasonYear(job.date));
  console.log(`Calendar on ${job.date}: ${calendar.period}; NFL Draft ${draft.start} to ${draft.end}`);
  console.log(`Running documents: ${Object.keys(snapshot.current ?? {}).join(", ") || "none yet"}`);
  console.log(`Documents: ${snapshot.documents.length}`);
  console.log(`Skipped: ${snapshot.skipped?.map((s) => `${s.outlet} (${s.reason})`).join(", ") || "none"}`);
} else {
  const result = await publish({ job: job.type, date: job.date, sources, writer: claudeOffseasonWriter() });
  if (result.status === "published") {
    console.log(`PUBLISHED: ${result.entries.length} entries pass every check.`);
    for (const entry of result.entries) {
      console.log(`\n## ${entry.data.title}  (${entry.path})`);
      console.log(JSON.stringify(entry.data, null, 2));
      console.log(entry.body);
    }
    if (values.out) {
      await writeEntries(values.out, result.entries);
      console.log(`\nWrote the entries under ${values.out}`);
    }
  } else {
    console.log(`REJECTED: ${result.failures.length} failed checks.`);
    for (const failure of result.failures) console.log(`  ${failure.check}  ${failure.entry ?? ""}  ${failure.reason}`);
    process.exitCode = 1;
  }
}
