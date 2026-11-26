// YouTube captions for the Film Room's QB School videos, via yt-dlp on the runner. Best effort:
// YouTube often answers cloud runners with "Sign in to confirm you're not a bot", and then the
// Film Room falls back to the video's title and description (ADR-0001). No cookies or account.
//
// ytDlpCaptions is thin on purpose: no unit tests (they would need the network and yt-dlp).
// vttToText is pure, and is exercised through the Film Room sources' tests.
import { execFile } from "node:child_process";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { CaptionFetcher } from "./film-room-sources";

const run = promisify(execFile);

export interface YtDlpOptions {
  /** The yt-dlp command. Defaults to $YT_DLP, then `yt-dlp`. */
  command?: string;
  timeoutMs?: number;
}

/** English captions (uploaded, else automatic) as WebVTT. Throws when yt-dlp fails or finds none. */
export function ytDlpCaptions(options: YtDlpOptions = {}): CaptionFetcher {
  const command = options.command ?? process.env.YT_DLP ?? "yt-dlp";
  const timeout = options.timeoutMs ?? 120_000;
  return async (videoUrl) => {
    const dir = await mkdtemp(path.join(tmpdir(), "gb-captions-"));
    try {
      await run(
        command,
        ["--skip-download", "--write-subs", "--write-auto-subs", "--sub-langs", "en.*", "--sub-format", "vtt", "--no-playlist", "-o", path.join(dir, "%(id)s.%(ext)s"), videoUrl],
        { timeout, maxBuffer: 16 * 1024 * 1024 },
      ).catch((error: { stderr?: string; message: string }) => {
        const last = error.stderr?.trim().split("\n").at(-1);
        throw new Error(last || error.message);
      });
      const vtt = (await readdir(dir)).filter((file) => file.endsWith(".vtt")).sort();
      // Uploaded English captions (en) before automatic ones (en-orig, en-...).
      const best = vtt.find((file) => /\.en\.vtt$/.test(file)) ?? vtt[0];
      if (!best) throw new Error("yt-dlp found no English captions");
      return await readFile(path.join(dir, best), "utf8");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  };
}

/**
 * WebVTT as plain text: no header, cue timings, or inline tags, and without the lines that
 * YouTube's rolling automatic captions repeat from one cue to the next.
 */
export function vttToText(vtt: string): string {
  const lines: string[] = [];
  for (const block of vtt.replace(/\r\n?/g, "\n").split(/\n{2,}/)) {
    const rows = block.split("\n");
    const timing = rows.findIndex((row) => row.includes("-->"));
    if (timing === -1) continue; // The header, a NOTE, or a STYLE block.
    for (const row of rows.slice(timing + 1)) {
      const line = decode(row.replace(/<[^>]*>/g, "")).replace(/\s+/g, " ").trim();
      if (line && !lines.slice(-2).includes(line)) lines.push(line);
    }
  }
  return lines.join(" ");
}

function decode(text: string): string {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
}
