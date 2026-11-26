// Manual smoke test for the real Film Room adapters. Not run by `npm test`: it uses the network,
// yt-dlp, and Whisper, and with --claude it calls the Claude API (a few cents per run).
//
//   WHISPER_PYTHON=.venv-whisper/bin/python npx tsx scripts/smoke-film-room.ts [--date YYYY-MM-DD]
//   WHISPER_PYTHON=.venv-whisper/bin/python npx tsx scripts/smoke-film-room.ts --claude [--out /tmp/gb-film]
//
// Sources only: lists the week's new QB School videos (with or without captions) and JFA episodes
// that have no Film Room entry in content/ yet. With --claude: runs publish() end to end and prints
// the entries or the failed checks. It never writes to the content folder; pass --out <dir> to
// have the published entries written there for a look. Needs yt-dlp on the PATH (or $YT_DLP) and
// Python with `pip install -r scripts/requirements-whisper.txt`.
import { parseArgs } from "node:util";
import { publish } from "../src/pipeline";
import { claudeFilmRoomWriter, filmRoomSources, realPodcastTranscripts, ytDlpCaptions } from "../src/pipeline/adapters/real";
import { writeEntries } from "../src/pipeline/content-store";
import { contentDir } from "../src/site/content-dir";

const { values } = parseArgs({
  options: {
    date: { type: "string", default: new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" }).format(new Date()) },
    claude: { type: "boolean", default: false },
    out: { type: "string" },
  },
});

const log = (message: string) => console.log(`  [sources] ${message}`);
const sources = filmRoomSources({ contentDir: contentDir(), podcasts: realPodcastTranscripts(log), captions: ytDlpCaptions(), log });
const job = { type: "film-room" as const, date: values.date };

if (!values.claude) {
  const snapshot = await sources.collect(job);
  console.log(`New breakdowns: ${snapshot.documents.length}`);
  for (const doc of snapshot.documents) {
    console.log(`\n- ${doc.film?.show}: ${doc.title}\n  ${doc.url}  (${doc.publishedAt})`);
    console.log(`  ${doc.film?.transcribed ? "transcribed" : "title and description only"}: ${doc.text.slice(0, 300)}${doc.text.length > 300 ? "..." : ""}`);
  }
  console.log(`\nSkipped: ${snapshot.skipped?.map((s) => `${s.outlet} (${s.reason})`).join(", ") || "none"}`);
} else {
  const result = await publish({ job: job.type, date: job.date, sources, writer: claudeFilmRoomWriter() });
  if (result.status === "published") {
    console.log(`PUBLISHED: ${result.entries.length} entries pass every check.`);
    for (const entry of result.entries) console.log(`\n## ${entry.data.title}  (${entry.path})\n${JSON.stringify(entry.data, null, 2)}\n${entry.body}`);
    if (values.out) {
      await writeEntries(values.out, result.entries);
      console.log(`\nWrote them under ${values.out}`);
    }
  } else {
    console.log("REJECTED:");
    for (const failure of result.failures) console.log(`  ${failure.check}: ${failure.entry ?? ""} ${failure.reason}`);
    process.exitCode = 1;
  }
}
