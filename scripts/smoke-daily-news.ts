// Manual smoke test for the real daily-news adapters. Not run by `npm test`: it uses the network,
// and with --claude it calls the Claude API (a few cents per run).
//
//   npx tsx scripts/smoke-daily-news.ts [--date YYYY-MM-DD]            # sources only, no API key
//   npx tsx scripts/smoke-daily-news.ts --claude [--date YYYY-MM-DD]   # + Claude writer and publish checks
//
// Sources only: fetches every Preferred Source and prints what the snapshot holds.
// With --claude: runs publish() end to end (real sources, real writer, every publish check) and
// prints the drafted News Summaries or the failed checks. It never writes to the content folder;
// pass --out <dir> to have the published entries written there for a look.
import { parseArgs } from "node:util";
import { publish } from "../src/pipeline";
import { writeEntries } from "../src/pipeline/content-store";
import { claudeWriter, realSources } from "../src/pipeline/adapters/real";

const { values } = parseArgs({
  options: {
    date: { type: "string", default: new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" }).format(new Date()) },
    claude: { type: "boolean", default: false },
    out: { type: "string" },
  },
});

const job = { type: "daily-news" as const, date: values.date };
const sources = realSources({ log: (message) => console.log(`  [sources] ${message}`) });

if (!values.claude) {
  const snapshot = await sources.collect(job);
  console.log(`Snapshot for ${snapshot.date}: ${snapshot.documents.length} documents`);
  for (const doc of snapshot.documents) {
    console.log(`  ${doc.outlet.padEnd(24)} ${doc.publishedAt.slice(0, 16)}  ${String(doc.text.length).padStart(6)} chars  ${doc.title}`);
    console.log(`  ${"".padEnd(24)} ${doc.url}`);
  }
  console.log(`Injury report: ${snapshot.injuryReport?.length ?? 0} players`);
  for (const line of snapshot.injuryReport ?? []) {
    console.log(`  ${line.player}: practice ${line.practiceStatus ?? "-"}, game ${line.gameStatus ?? "-"}`);
  }
  console.log(`Skipped: ${snapshot.skipped?.map((s) => `${s.outlet} (${s.reason})`).join(", ") || "none"}`);
} else {
  const result = await publish({ job: job.type, date: job.date, sources, writer: claudeWriter() });
  if (result.status === "published") {
    console.log(`PUBLISHED: ${result.entries.length} News Summaries pass every check.`);
    for (const entry of result.entries) {
      console.log(`\n## [${entry.data.category}] ${entry.data.title}  (${entry.path})`);
      console.log(entry.body);
      console.log(`sources: ${entry.data.sources.map((s) => s.url).join(", ")}`);
      if (entry.data.quotes) console.log(`quotes: ${entry.data.quotes.map((q) => `${q.speaker}: "${q.text}"`).join(" | ")}`);
      if (entry.data.injuries) console.log(`injuries: ${JSON.stringify(entry.data.injuries)}`);
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
