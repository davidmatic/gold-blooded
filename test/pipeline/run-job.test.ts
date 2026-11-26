import { mkdtemp, readFile, readdir, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runJob, type DraftEntry } from "../../src/pipeline";
import { fakeSources, fakeWriter, recordedSnapshot } from "../support/fakes";

const snapshot = recordedSnapshot("daily-news-2026-11-25");
const SHANAHAN_URL = "https://www.49ers.com/news/shanahan-press-conference-wednesday";

const coachDraft: DraftEntry = {
  type: "news-summary",
  data: {
    title: "Shanahan wants more on third down",
    category: "Coach's Comments",
    sources: [{ url: SHANAHAN_URL, outlet: "49ers.com" }],
  },
  body: 'Kyle Shanahan said, "We have to be better on third down."',
};

describe("running a job against the content folder", () => {
  let contentDir: string;

  beforeEach(async () => {
    contentDir = await mkdtemp(path.join(tmpdir(), "gold-blooded-content-"));
    await mkdir(path.join(contentDir, "news"));
    await writeFile(path.join(contentDir, "news", "2026-11-24-earlier.md"), "existing\n");
  });

  afterEach(() => rm(contentDir, { recursive: true, force: true }));

  it("writes each published entry as Markdown with frontmatter", async () => {
    const result = await runJob({
      job: "daily-news",
      date: "2026-11-25",
      sources: fakeSources(snapshot),
      writer: fakeWriter([coachDraft]),
      contentDir,
    });

    expect(result.status).toBe("published");
    expect(await readFile(path.join(contentDir, "news", "2026-11-25-shanahan-wants-more-on-third-down.md"), "utf8"))
      .toBe(`---
title: "Shanahan wants more on third down"
category: "Coach's Comments"
date: "2026-11-25"
sources:
  - url: "${SHANAHAN_URL}"
    outlet: "49ers.com"
---
Kyle Shanahan said, "We have to be better on third down."
`);
  });

  it("writes nothing when the run is rejected", async () => {
    const result = await runJob({
      job: "daily-news",
      date: "2026-11-25",
      sources: fakeSources(snapshot, { deadLinks: [SHANAHAN_URL] }),
      writer: fakeWriter([coachDraft]),
      contentDir,
    });

    expect(result.status).toBe("rejected");
    expect(await readdir(contentDir, { recursive: true })).toEqual(["news", path.join("news", "2026-11-24-earlier.md")]);
    expect(await readFile(path.join(contentDir, "news", "2026-11-24-earlier.md"), "utf8")).toBe("existing\n");
  });
});
