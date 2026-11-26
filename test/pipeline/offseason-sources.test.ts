// The real Offseason sources, driven through their SourceAdapter interface with a fake page
// fetcher, a fake news collector, and a temporary content folder. No network.
import { readFileSync } from "node:fs";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runJob, type DraftEntry } from "../../src/pipeline";
import { offseasonSources } from "../../src/pipeline/adapters/real/offseason-sources";
import { SCHEDULE_URL } from "../../src/pipeline/adapters/real/schedule";
import type { FetchPage } from "../../src/pipeline/adapters/real/sources";
import { fakeSources, fakeWriter, recordedSnapshot } from "../support/fakes";

const csv = readFileSync(new URL("../fixtures/sources/nflverse-games-excerpt.csv", import.meta.url), "utf8");
const offseason = recordedSnapshot("offseason-2026");
const HALE = { url: "https://www.49ers.com/news/49ers-sign-cb-marcus-hale", outlet: "49ers.com" };
const job = { type: "offseason" as const, date: "2026-03-13" };

const fetchPage: FetchPage = async (url) => (url === SCHEDULE_URL ? { status: 200, body: csv } : { status: 404, body: "Not found" });

describe("real sources: the Offseason snapshot", () => {
  let contentDir: string;
  beforeEach(async () => {
    contentDir = await mkdtemp(path.join(tmpdir(), "gold-blooded-offseason-"));
  });
  afterEach(() => rm(contentDir, { recursive: true, force: true }));

  it("adds the schedule, and has no running documents before the Offseason's first update", async () => {
    const snapshot = await offseasonSources({ contentDir, fetchPage, news: fakeSources(offseason) }).collect(job);

    expect(snapshot.documents).toEqual(offseason.documents);
    expect(snapshot.schedule?.length).toBeGreaterThan(0);
    expect(snapshot.current).toEqual({});
  });

  it("reads back the running documents the pipeline wrote, as they stand", async () => {
    const drafts: DraftEntry[] = [
      {
        type: "free-agency-tracker",
        data: { moves: [{ player: "Marcus Hale", position: "CB", kind: "signing", date: "2026-03-11", source: HALE }], sources: [] },
        body: "A splash.",
      },
      { type: "draft-coverage", data: { teamNeeds: [{ position: "OT", note: "Depth." }], mockDrafts: [], picks: [], profiles: [], sources: [HALE] }, body: "Pick 27." },
    ];
    const first = await runJob({ job: "offseason", date: "2026-03-12", sources: fakeSources(offseason), writer: fakeWriter(drafts), contentDir });
    expect(first.status).toBe("published");

    const snapshot = await offseasonSources({ contentDir, fetchPage, news: fakeSources(offseason) }).collect(job);

    expect(snapshot.current?.["free-agency-tracker"]).toEqual({
      data: {
        title: "2026 Free Agency Tracker",
        offseason: 2026,
        updated: "2026-03-12",
        sources: [HALE],
        moves: [{ player: "Marcus Hale", position: "CB", kind: "signing", date: "2026-03-11", source: HALE }],
      },
      body: "A splash.\n",
    });
    expect(snapshot.current?.["draft-coverage"]?.data.teamNeeds).toEqual([{ position: "OT", note: "Depth." }]);
  });

  it("reads a hand-edited document, unquoted dates and all", async () => {
    await mkdir(path.join(contentDir, "offseason", "2026"), { recursive: true });
    await writeFile(
      path.join(contentDir, "offseason", "2026", "free-agency-tracker.md"),
      [
        "---",
        "title: 2026 Free Agency Tracker",
        "offseason: 2026",
        "updated: 2026-03-12",
        "sources: []",
        "moves:",
        "  - player: Marcus Hale",
        "    position: CB",
        "    kind: signing",
        "    date: 2026-03-11",
        "    source: { url: 'https://www.49ers.com/news/49ers-sign-cb-marcus-hale', outlet: 49ers.com }",
        "---",
        "Fixed by hand.",
        "",
      ].join("\n"),
    );

    const snapshot = await offseasonSources({ contentDir, fetchPage, news: fakeSources(offseason) }).collect(job);

    expect(snapshot.current?.["free-agency-tracker"]?.data.moves[0]).toEqual({ player: "Marcus Hale", position: "CB", kind: "signing", date: "2026-03-11", source: HALE });
  });
});
