// The real transcriber: downloads an episode's audio and runs open-source Whisper on it
// (faster-whisper, via scripts/transcribe.py) on the job runner, so transcription costs nothing.
//
// Thin on purpose: no unit tests (they would need the network and Whisper). Check it with
// scripts/smoke-podcasts.ts. Needs Python with `pip install -r scripts/requirements-whisper.txt`.
import { execFile } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import type { Transcriber } from "./transcripts";

const run = promisify(execFile);

export const TRANSCRIBE_SCRIPT = fileURLToPath(new URL("../../scripts/transcribe.py", import.meta.url));

export interface WhisperOptions {
  /** Python with faster-whisper installed. Defaults to $WHISPER_PYTHON, then `python3`. */
  python?: string;
  /** Whisper model. Defaults to $WHISPER_MODEL, then `small.en` (int8 on CPU). */
  model?: string;
  /** Sent when downloading the audio. */
  userAgent?: string;
  /** Longest one episode may take, download and transcription together. */
  timeoutMs?: number;
  /** Where Whisper's timing line goes. Defaults to console.log. */
  log?: (message: string) => void;
}

export function whisperTranscriber(options: WhisperOptions = {}): Transcriber {
  const python = options.python ?? process.env.WHISPER_PYTHON ?? "python3";
  const model = options.model ?? process.env.WHISPER_MODEL ?? "small.en";
  const timeoutMs = options.timeoutMs ?? 60 * 60_000;
  const log = options.log ?? ((message: string) => console.log(message));

  return {
    name: `faster-whisper ${model}`,
    async transcribe({ audioUrl, prompt }) {
      const dir = await mkdtemp(path.join(tmpdir(), "gb-whisper-"));
      try {
        const audio = path.join(dir, "episode.mp3");
        const out = path.join(dir, "transcript.txt");
        const response = await fetch(audioUrl, {
          headers: options.userAgent ? { "User-Agent": options.userAgent } : {},
          redirect: "follow",
          signal: AbortSignal.timeout(10 * 60_000),
        });
        if (!response.ok || !response.body) throw new Error(`audio download failed: HTTP ${response.status}`);
        await pipeline(Readable.fromWeb(response.body as NodeReadableStream), createWriteStream(audio));
        const { stderr } = await run(python, [TRANSCRIBE_SCRIPT, audio, out, "--model", model, "--prompt", prompt], {
          timeout: timeoutMs,
          maxBuffer: 16 * 1024 * 1024,
        });
        const timing = stderr.trim().split("\n").at(-1);
        if (timing) log(`whisper: ${timing}`);
        return await readFile(out, "utf8");
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    },
  };
}
