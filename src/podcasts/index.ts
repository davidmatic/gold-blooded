// Podcasts: feeds, transcription, and the transcript cache. Used by the daily news sources
// and the Film Room; nothing here depends on a job type.
//
// Real use (network and Whisper):
//   podcastTranscripts({ fetchPage, transcriber: whisperTranscriber(), cacheDir: transcriptCacheDir() })
//     .latest(PODCASTS.jfa, { limit: 2, from, to })
import path from "node:path";

export { PODCASTS, appleLookupUrl, type Podcast } from "./shows";
export {
  podcastTranscripts,
  type FetchPage,
  type LatestOptions,
  type PodcastEpisode,
  type PodcastTranscripts,
  type PodcastTranscriptsOptions,
  type Transcriber,
} from "./transcripts";
export { whisperTranscriber, type WhisperOptions } from "./whisper";

/**
 * The transcript cache, committed to the repo so every workflow (and a local run) shares it:
 * `data/transcripts/` at the repo root, or $GOLD_BLOODED_TRANSCRIPTS_DIR.
 */
export function transcriptCacheDir(): string {
  return path.resolve(process.env.GOLD_BLOODED_TRANSCRIPTS_DIR ?? "data/transcripts");
}
