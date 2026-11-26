// Manual smoke test for the real post-game adapters. Not run by `npm test`: it uses the network,
// and with --claude it calls the Claude API (a few cents per run).
//
//   npx tsx scripts/smoke-post-game.ts [--date YYYY-MM-DD]            # sources only, no API key
//   npx tsx scripts/smoke-post-game.ts --claude [--date YYYY-MM-DD]   # + Claude writer and publish checks
//
// Pick a date the day after a 49ers game (default: today, Pacific). Sources only: fetches the
// nflverse schedule, and the day after a game the day's news, the season's nflverse stats, and
// the official YouTube clips, and prints what it found. With --claude: runs publish() end to end
// and prints the Highlights and Season Stats or the failed checks. It never writes to the content
// folder; pass --out <dir> to have the published entries written there for a look.
import { parseArgs } from "node:util";
import { publish } from "../src/pipeline";
import { claudePostGameWriter, postGameSources } from "../src/pipeline/adapters/real";
import { gameJustPlayed, resolveCalendar } from "../src/pipeline/calendar";
import { writeEntries } from "../src/pipeline/content-store";
import { contentDir } from "../src/site/content-dir";

const { values } = parseArgs({
  options: {
    date: { type: "string", default: new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" }).format(new Date()) },
    claude: { type: "boolean", default: false },
    out: { type: "string" },
  },
});

const job = { type: "post-game" as const, date: values.date };
const sources = postGameSources({ contentDir: contentDir(), log: (message) => console.log(`  [sources] ${message}`) });

if (!values.claude) {
  const snapshot = await sources.collect(job);
  const game = gameJustPlayed(resolveCalendar(job.date, snapshot.schedule ?? []), job.date);
  console.log(`Schedule: ${snapshot.schedule?.length ?? 0} 49ers games`);
  console.log(`Game the day before ${job.date}: ${game ? `${game.gameId}, ${game.result ? `${game.result.sf}-${game.result.opponent}` : "no final score yet"}` : "none (the job writes nothing)"}`);
  console.log(`Documents: ${snapshot.documents.length}`);
  console.log(`nflverse stats: ${snapshot.stats ? `${snapshot.stats.players.length} player lines, ${snapshot.stats.teams.length} team lines` : "none"}`);
  console.log(`Official clips: ${snapshot.videos?.map((v) => `\n  ${v.videoId}  ${v.channel}: ${v.title}`).join("") || "none"}`);
  console.log(`Game Preview to score: ${snapshot.gamePreview ? `${snapshot.gamePreview.prediction.winner} ${snapshot.gamePreview.prediction.score.sf}-${snapshot.gamePreview.prediction.score.opponent}` : "none (the Prediction Record skips the game)"}`);
  console.log(`Skipped: ${snapshot.skipped?.map((s) => `${s.outlet} (${s.reason})`).join(", ") || "none"}`);
} else {
  const result = await publish({ job: job.type, date: job.date, sources, writer: claudePostGameWriter() });
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
