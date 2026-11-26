// Manual smoke test for podcast transcription. Not run by `npm test`: it uses the network and
// runs Whisper. Needs `pip install -r scripts/requirements-whisper.txt` (set WHISPER_PYTHON to
// pick the Python, WHISPER_MODEL to pick the model; default small.en).
//
//   npx tsx scripts/smoke-podcasts.ts [--show 49ers-talk|jfa] [--limit 1] [--cache-dir DIR]
//
// Transcribes the show's newest episode(s), whatever their date, and prints how long it took
// and the start of each transcript. The cache defaults to a temporary folder, so nothing is
// added to data/transcripts/ unless you pass --cache-dir data/transcripts.
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import { BOT_USER_AGENT, fetchWithBotUserAgent } from "../src/pipeline/adapters/real/sources";
import { PODCASTS, podcastTranscripts, whisperTranscriber } from "../src/podcasts";

const { values } = parseArgs({
  options: {
    show: { type: "string", default: PODCASTS.ninersTalk.id },
    limit: { type: "string", default: "1" },
    "cache-dir": { type: "string" },
  },
});

const podcast = Object.values(PODCASTS).find((p) => p.id === values.show);
if (!podcast) throw new Error(`unknown --show "${values.show}" (known: ${Object.values(PODCASTS).map((p) => p.id).join(", ")})`);
const cacheDir = values["cache-dir"] ?? (await mkdtemp(path.join(tmpdir(), "gb-transcripts-")));
const log = (message: string) => console.log(`  ${message}`);

const started = Date.now();
const episodes = await podcastTranscripts({
  fetchPage: fetchWithBotUserAgent,
  transcriber: whisperTranscriber({ userAgent: BOT_USER_AGENT, log }),
  cacheDir,
  log,
}).latest(podcast, { limit: Number(values.limit) });

for (const episode of episodes) {
  const minutes = episode.durationSeconds ? `${(episode.durationSeconds / 60).toFixed(0)} min` : "unknown length";
  console.log(`\n## ${episode.show}: ${episode.title} (${episode.publishedAt.slice(0, 10)}, ${minutes})`);
  console.log(`link: ${episode.episodeUrl}`);
  if (episode.transcript) {
    console.log(`transcript: ${episode.transcript.length} chars\n${episode.transcript.slice(0, 800)}...`);
  } else {
    console.log(`NO TRANSCRIPT: ${episode.transcriptError}`);
    process.exitCode = 1;
  }
}
console.log(`\nDone in ${((Date.now() - started) / 60_000).toFixed(1)} min. Cache: ${cacheDir}`);
