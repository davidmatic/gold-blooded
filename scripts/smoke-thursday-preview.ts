// Manual smoke test for the real Thursday preview adapters. Not run by `npm test`: it uses the
// network, and with --claude it calls the Claude API (a few cents per run).
//
//   npx tsx scripts/smoke-thursday-preview.ts [--date YYYY-MM-DD]            # sources + calendar, no API key
//   npx tsx scripts/smoke-thursday-preview.ts --claude [--date YYYY-MM-DD]   # + Claude writer and publish checks
//
// Sources only: fetches the nflverse schedule and stats, and the day's Preferred Sources, and prints where
// the date falls on the calendar. With --claude: runs publish() end to end and prints the Game
// Preview and Stat Breakdown (or season recap) or the failed checks. It never writes to the content folder; pass
// --out <dir> to have the published entries written there for a look.
import { parseArgs } from "node:util";
import { publish } from "../src/pipeline";
import { claudePreviewWriter, previewSources } from "../src/pipeline/adapters/real";
import { resolveCalendar } from "../src/pipeline/calendar";
import { writeEntries } from "../src/pipeline/content-store";

const { values } = parseArgs({
  options: {
    date: { type: "string", default: new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" }).format(new Date()) },
    claude: { type: "boolean", default: false },
    out: { type: "string" },
  },
});

const job = { type: "thursday-preview" as const, date: values.date };
const sources = previewSources({ log: (message) => console.log(`  [sources] ${message}`) });

if (!values.claude) {
  const snapshot = await sources.collect(job);
  const calendar = resolveCalendar(job.date, snapshot.schedule ?? []);
  console.log(`Schedule: ${snapshot.schedule?.length ?? 0} 49ers games`);
  console.log(`Calendar on ${job.date}: ${calendar.period}`);
  if (calendar.period !== "offseason") {
    console.log(`  Game Week ${calendar.gameWeek}; upcoming ${calendar.upcoming.gameId} at ${calendar.upcoming.kickoff}`);
  }
  if (calendar.period === "game-week" || calendar.period === "bye-week") console.log(`  previous ${calendar.previous?.gameId ?? "none"}`);
  console.log(`Documents: ${snapshot.documents.length}; injury report: ${snapshot.injuryReport?.length ?? 0} players`);
  console.log(`nflverse stats: ${snapshot.stats ? `${snapshot.stats.players.length} player lines, ${snapshot.stats.teams.length} team lines` : "none (Offseason)"}`);
  console.log(`Skipped:${snapshot.skipped?.map((s) => `${s.outlet} (${s.reason})`).join(", ") || "none"}`);
} else {
  const result = await publish({ job: job.type, date: job.date, sources, writer: claudePreviewWriter() });
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
