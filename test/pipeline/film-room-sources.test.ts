// The real Film Room sources, driven through their SourceAdapter interface and through the
// publish pipeline (Seam 1), with a fake page fetcher (saved feed captures), a fake caption
// fetcher standing in for yt-dlp, the real podcast transcription unit with a fake transcriber,
// and temporary content and transcript folders. No network, no yt-dlp, no Whisper, no Claude.
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { publish, type DraftEntry, type Job } from "../../src/pipeline";
import { filmRoomSources, QB_SCHOOL_FEED, type CaptionFetcher } from "../../src/pipeline/adapters/real/film-room-sources";
import type { FetchPage } from "../../src/pipeline/adapters/real/sources";
import { PODCASTS, podcastTranscripts, type Transcriber } from "../../src/podcasts";
import { fakeWriter } from "../support/fakes";

const fixture = (name: string) => readFile(new URL(`../fixtures/sources/${name}`, import.meta.url), "utf8");

const PURDY_VIDEO = "https://www.youtube.com/watch?v=qbPurdy0001";
const SHANAHAN_VIDEO = "https://www.youtube.com/watch?v=qbNiners002";
const JFA_355 = "https://www.buzzsprout.com/2047939/episodes/20168779";
const JFA_354 = "https://www.buzzsprout.com/2047939/episodes/20156521";

const job: Job = { type: "film-room", date: "2026-11-25" };
const quiet = () => {};

function fakeFetch(overrides: Record<string, { status: number; body: string }> = {}): FetchPage {
  const pages: Record<string, string> = { [QB_SCHOOL_FEED]: "qb-school-feed.xml", [PODCASTS.jfa.feedUrl]: "jfa-feed.xml" };
  return async (url) => {
    if (overrides[url]) return overrides[url];
    const file = pages[url];
    return file ? { status: 200, body: await fixture(file) } : { status: 404, body: "Not found" };
  };
}

/** Serves the saved captions for every video, or fails like a runner YouTube won't serve. */
function fakeCaptions(mode: "ok" | "blocked"): CaptionFetcher & { asked: string[] } {
  const asked: string[] = [];
  const fetchCaptions = async (videoUrl: string) => {
    asked.push(videoUrl);
    if (mode === "blocked") throw new Error("Sign in to confirm you're not a bot");
    return fixture("qb-school-captions.en.vtt");
  };
  return Object.assign(fetchCaptions, { asked });
}

function fakeTranscriber(fail: string[] = []): Transcriber & { calls: string[] } {
  const calls: string[] = [];
  return {
    name: "fake-whisper",
    calls,
    async transcribe({ audioUrl }) {
      calls.push(audioUrl);
      if (fail.some((part) => audioUrl.includes(part))) throw new Error("whisper crashed");
      return `Jonnydel here. Transcript of ${audioUrl}. Purdy was fantastic.`;
    },
  };
}

describe("real Film Room sources", () => {
  let dir: string;
  let contentDir: string;
  let cacheDir: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "gold-blooded-film-"));
    contentDir = path.join(dir, "content");
    cacheDir = path.join(dir, "transcripts");
    await mkdir(contentDir);
  });
  afterEach(() => rm(dir, { recursive: true, force: true }));

  function sources(options: { captions?: CaptionFetcher; transcriber?: Transcriber; fetchPage?: FetchPage } = {}) {
    const fetchPage = options.fetchPage ?? fakeFetch();
    const podcasts = podcastTranscripts({ fetchPage, transcriber: options.transcriber ?? fakeTranscriber(), cacheDir, log: quiet });
    return filmRoomSources({ contentDir, fetchPage, podcasts, captions: options.captions ?? fakeCaptions("ok"), log: quiet });
  }

  it("collects the week's 49ers QB School videos with their captions as the text", async () => {
    const snapshot = await sources().collect(job);
    const videos = snapshot.documents.filter((doc) => doc.film?.show === "The QB School");

    // The Stroud video isn't about the 49ers, and the Dallas one is more than a week old.
    expect(videos.map((doc) => doc.url)).toEqual([PURDY_VIDEO, SHANAHAN_VIDEO]);
    expect(videos[0]).toMatchObject({
      outlet: "The QB School",
      title: "Brock Purdy vs the Vikings Week 11, 2026 Analysis",
      publishedAt: "2026-11-24T17:00:00.000Z",
      text: "what's up everybody let's talk about Brock Purdy he's reading the safety",
      film: { show: "The QB School", medium: "video", transcribed: true },
    });
    expect(videos[0]!.film!.description).toContain("Breaking down Brock Purdy's three touchdowns");
  });

  it("falls back to a video's description when its captions are blocked, and says so", async () => {
    const snapshot = await sources({ captions: fakeCaptions("blocked") }).collect(job);
    const video = snapshot.documents.find((doc) => doc.url === PURDY_VIDEO);

    expect(video).toMatchObject({ text: expect.stringContaining("Breaking down Brock Purdy's three touchdowns"), film: { transcribed: false } });
    expect(snapshot.skipped).toContainEqual({
      outlet: "The QB School",
      reason: `no captions for "Brock Purdy vs the Vikings Week 11, 2026 Analysis" (Sign in to confirm you're not a bot); using its title and description`,
    });
  });

  it("publishes entries for every new breakdown even when every caption fetch is blocked", async () => {
    const drafts: DraftEntry[] = [
      { type: "film-room", data: { title: "Purdy in Mexico City", link: PURDY_VIDEO, purdy: true }, body: "The QB School breaks down Purdy's three touchdowns." },
      { type: "film-room", data: { title: "Shanahan's play-action", link: SHANAHAN_VIDEO, purdy: false }, body: "The QB School on the 49ers' play-action game." },
      { type: "film-room", data: { title: "Victory Monday", link: JFA_355, purdy: true }, body: "On Jonnydel's Football Academy, Jonnydel says Purdy was fantastic." },
      { type: "film-room", data: { title: "Preview Friday", link: JFA_354, purdy: true }, body: "On Jonnydel's Football Academy, Jonnydel says Purdy was fantastic." },
    ];
    const adapter = sources({ captions: fakeCaptions("blocked") });
    const result = await publish({ job: "film-room", date: job.date, sources: { ...adapter, linkResolves: async () => true }, writer: fakeWriter(drafts) });

    expect(result.status, JSON.stringify(result)).toBe("published");
    if (result.status !== "published") return;
    expect(result.entries.find((entry) => entry.type === "film-room" && entry.data.link === PURDY_VIDEO)?.data).toMatchObject({ show: "The QB School", transcribed: false, purdy: true });
  });

  it("collects the week's JFA episodes, transcribed through the podcast transcription and credited to Jonnydel", async () => {
    const transcriber = fakeTranscriber();
    const snapshot = await sources({ transcriber }).collect(job);
    const episodes = snapshot.documents.filter((doc) => doc.film?.medium === "podcast");

    expect(episodes.map((doc) => doc.url)).toEqual([JFA_355, JFA_354]);
    expect(episodes[0]).toMatchObject({
      outlet: "Jonnydel's Football Academy",
      title: "JFA Podcast 355: Victory Monday - The Three Amigos Lead the 49ers to Victory in Mexico City",
      text: expect.stringContaining("Purdy was fantastic"),
      podcast: { show: "Jonnydel's Football Academy", hosts: ["Jonnydel"] },
      film: { show: "Jonnydel's Football Academy", medium: "podcast", transcribed: true },
    });
    // The transcript cache is the shared one: the next run (or the daily news) reuses it.
    const again = fakeTranscriber();
    await sources({ transcriber: again }).collect(job);
    expect(again.calls).toEqual([]);
  });

  it("falls back to an episode's show notes when it can't be transcribed", async () => {
    const snapshot = await sources({ transcriber: fakeTranscriber(["20168779"]) }).collect(job);
    const episode = snapshot.documents.find((doc) => doc.url === JFA_355);

    expect(episode?.film?.transcribed).toBe(false);
    expect(episode?.text).toBe(episode?.film?.description);
    expect(episode?.text).not.toBe("");
  });

  it("skips breakdowns that already have a Film Room entry", async () => {
    await mkdir(path.join(contentDir, "film-room"));
    await writeFile(path.join(contentDir, "film-room", "2026-11-24-purdy.md"), `---\ntitle: "Purdy"\nlink: "${PURDY_VIDEO}"\n---\nBody.\n`);
    await writeFile(path.join(contentDir, "film-room", "2026-11-24-jfa.md"), `---\ntitle: "JFA"\nlink: "${JFA_355}"\n---\nBody.\n`);
    const captions = fakeCaptions("ok");
    const transcriber = fakeTranscriber();

    const snapshot = await sources({ captions, transcriber }).collect(job);

    expect(snapshot.documents.map((doc) => doc.url)).toEqual([SHANAHAN_VIDEO, JFA_354]);
    expect(captions.asked).toEqual([SHANAHAN_VIDEO]);
    expect(transcriber.calls).not.toContainEqual(expect.stringContaining("20168779"));
  });

  it("goes on without a show whose feed won't load", async () => {
    const snapshot = await sources({ fetchPage: fakeFetch({ [QB_SCHOOL_FEED]: { status: 503, body: "" } }) }).collect(job);

    expect(snapshot.documents.map((doc) => doc.url)).toEqual([JFA_355, JFA_354]);
    expect(snapshot.skipped).toContainEqual({ outlet: "The QB School", reason: "HTTP 503" });
  });
});
