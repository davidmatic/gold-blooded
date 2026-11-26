// Fake adapters for Seam 1 (the publish pipeline). Nothing here touches the network.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ContentWriter, DraftEntry, SourceAdapter, SourceSnapshot } from "../../src/pipeline";

const snapshotsRoot = fileURLToPath(new URL("../fixtures/snapshots", import.meta.url));

/** A recorded source snapshot from `test/fixtures/snapshots/<name>.json`. */
export function recordedSnapshot(name: string): SourceSnapshot {
  return JSON.parse(readFileSync(path.join(snapshotsRoot, `${name}.json`), "utf8"));
}

/**
 * Serves a recorded snapshot. Every link resolves unless it is listed in `deadLinks`.
 */
export function fakeSources(snapshot: SourceSnapshot, options: { deadLinks?: string[] } = {}): SourceAdapter {
  const dead = new Set(options.deadLinks ?? []);
  return {
    collect: async () => snapshot,
    linkResolves: async (url) => !dead.has(url),
  };
}

/** Returns canned drafts, whatever the job and snapshot. */
export function fakeWriter(drafts: DraftEntry[]): ContentWriter {
  return { write: async () => drafts };
}
