// The podcast transcription unit, driven through its public interface with a fake page
// fetcher (saved feed captures in test/fixtures/sources/), a fake transcriber, and a temporary
// transcript cache. No network, no Whisper.
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { PODCASTS, podcastTranscripts, type FetchPage, type Transcriber } from "../../src/podcasts";

const fixture = (name: string) => readFileSync(new URL(`../fixtures/sources/${name}`, import.meta.url), "utf8");

const APPLE_LOOKUP = "https://itunes.apple.com/lookup?id=1153457233&entity=podcastEpisode&limit=25";
const PAGES: Record<string, string> = {
  [PODCASTS.ninersTalk.feedUrl]: "49ers-talk-feed.xml",
  [PODCASTS.jfa.feedUrl]: "jfa-feed.xml",
  [APPLE_LOOKUP]: "49ers-talk-apple-lookup.json",
};

function fakeFetch(overrides: Record<string, { status: number; body: string } | Error> = {}): FetchPage & { calls: string[] } {
  const calls: string[] = [];
  const fetchPage = async (url: string) => {
    calls.push(url);
    const override = overrides[url];
    if (override instanceof Error) throw override;
    if (override) return override;
    const file = PAGES[url];
    return file ? { status: 200, body: fixture(file) } : { status: 404, body: "Not found" };
  };
  return Object.assign(fetchPage, { calls });
}

/** Transcribes any audio as "Transcript of <url>", and remembers what it was asked to do. */
function fakeTranscriber(fail: string[] = []): Transcriber & { calls: string[] } {
  const calls: string[] = [];
  return {
    name: "fake-whisper",
    calls,
    async transcribe({ audioUrl }) {
      calls.push(audioUrl);
      if (fail.some((part) => audioUrl.includes(part))) throw new Error("whisper crashed");
      return `Transcript of ${audioUrl}`;
    },
  };
}

const quiet = () => {};
// The job's day and the day before, in Pacific time, as the daily news job uses.
const NOV_25_WINDOW = { from: "2026-11-24T08:00:00.000Z", to: "2026-11-26T08:00:00.000Z" };
const NEWEST_TALK = "bef9e9dd-a899-4978-bff6-3341812da8eb";

let cacheDir: string;
beforeEach(() => {
  cacheDir = mkdtempSync(path.join(tmpdir(), "gb-transcripts-"));
});

describe("podcast transcripts", () => {
  it("transcribes the newest 49ers Talk episode in the window and links to its Apple Podcasts page", async () => {
    const transcriber = fakeTranscriber();
    const podcasts = podcastTranscripts({ fetchPage: fakeFetch(), transcriber, cacheDir, log: quiet });

    const episodes = await podcasts.latest(PODCASTS.ninersTalk, { ...NOV_25_WINDOW, limit: 2 });

    expect(episodes).toHaveLength(1);
    expect(episodes[0]).toMatchObject({
      guid: NEWEST_TALK,
      show: "49ers Talk",
      hosts: ["Matt Maiocco", "Jennifer Lee Chan"],
      title: "Brock Purdy misses practice as 49ers prepare to face desperate Seahawks",
      publishedAt: "2026-11-26T02:32:18.000Z",
      durationSeconds: 37 * 60 + 19,
      episodeUrl: "https://podcasts.apple.com/us/podcast/brock-purdy-misses-practice-as-49ers-prepare-to-face/id1153457233?i=1000804108161",
    });
    expect(episodes[0]!.description).toContain("co-hosts Matt Maiocco and Jennifer Lee Chan discuss");
    expect(episodes[0]!.audioUrl).toMatch(/^https:\/\/dts\.podtrac\.com\/redirect\.mp3\//);
    expect(episodes[0]!.transcript).toBe(`Transcript of ${episodes[0]!.audioUrl}`);
    expect(transcriber.calls).toEqual([episodes[0]!.audioUrl]);
  });

  it("transcribes an episode only once: a later run reads it from the cache", async () => {
    const transcriber = fakeTranscriber();
    const first = await podcastTranscripts({ fetchPage: fakeFetch(), transcriber, cacheDir, log: quiet }).latest(PODCASTS.ninersTalk, {
      ...NOV_25_WINDOW,
      limit: 1,
    });

    // A new run, a new transcriber, the same cache folder.
    const later = fakeTranscriber();
    const again = await podcastTranscripts({ fetchPage: fakeFetch(), transcriber: later, cacheDir, log: quiet }).latest(PODCASTS.ninersTalk, {
      ...NOV_25_WINDOW,
      limit: 1,
    });

    expect(later.calls).toEqual([]);
    expect(again[0]!.transcript).toBe(first[0]!.transcript);
    const file = JSON.parse(readFileSync(path.join(cacheDir, "49ers-talk", `${NEWEST_TALK}.json`), "utf8"));
    expect(file).toMatchObject({ guid: NEWEST_TALK, show: "49ers Talk", transcribedWith: "fake-whisper", text: first[0]!.transcript });
  });

  it("takes at most `limit` episodes, newest first, and links JFA episodes to their Buzzsprout pages", async () => {
    const podcasts = podcastTranscripts({ fetchPage: fakeFetch(), transcriber: fakeTranscriber(), cacheDir, log: quiet });

    const episodes = await podcasts.latest(PODCASTS.jfa, { limit: 2 });

    expect(episodes.map((e) => [e.title, e.episodeUrl, e.durationSeconds])).toEqual([
      ["JFA Podcast 355: Victory Monday - The Three Amigos Lead the 49ers to Victory in Mexico City", "https://www.buzzsprout.com/2047939/episodes/20168779", 3816],
      ["JFA Podcast 354: Preview Friday - Battle of the Best in Mexico City", "https://www.buzzsprout.com/2047939/episodes/20156521", expect.any(Number)],
    ]);
    expect(episodes[0]).toMatchObject({ show: "Jonnydel's Football Academy", hosts: ["Jonnydel"], publishedAt: "2026-11-23T16:00:00.000Z" });
  });

  it("leaves out excluded episodes", async () => {
    const podcasts = podcastTranscripts({ fetchPage: fakeFetch(), transcriber: fakeTranscriber(), cacheDir, log: quiet });

    const episodes = await podcasts.latest(PODCASTS.jfa, { limit: 1, exclude: ["https://www.buzzsprout.com/2047939/episodes/20168779"] });

    expect(episodes.map((e) => e.guid)).toEqual(["Buzzsprout-20156521"]);
  });

  it("keeps an episode it couldn't transcribe, without a transcript, and tries again next run", async () => {
    const failing = fakeTranscriber(["20168779"]);
    const podcasts = podcastTranscripts({ fetchPage: fakeFetch(), transcriber: failing, cacheDir, log: quiet });

    const episodes = await podcasts.latest(PODCASTS.jfa, { limit: 2 });

    expect(episodes[0]).toMatchObject({ guid: "Buzzsprout-20168779", transcriptError: "whisper crashed" });
    expect(episodes[0]!.transcript).toBeUndefined();
    expect(episodes[1]!.transcript).toBeDefined();

    const retry = fakeTranscriber();
    await podcastTranscripts({ fetchPage: fakeFetch(), transcriber: retry, cacheDir, log: quiet }).latest(PODCASTS.jfa, { limit: 2 });
    expect(retry.calls).toEqual([episodes[0]!.audioUrl]);
  });

  it("links to the audio when the Apple Podcasts lookup fails", async () => {
    const fetchPage = fakeFetch({ [APPLE_LOOKUP]: { status: 503, body: "" } });
    const podcasts = podcastTranscripts({ fetchPage, transcriber: fakeTranscriber(), cacheDir, log: quiet });

    const [episode] = await podcasts.latest(PODCASTS.ninersTalk, { ...NOV_25_WINDOW, limit: 1 });

    expect(episode!.episodeUrl).toBe(episode!.audioUrl);
  });

  it("fails when the feed can't be fetched", async () => {
    const fetchPage = fakeFetch({ [PODCASTS.jfa.feedUrl]: { status: 500, body: "" } });
    const podcasts = podcastTranscripts({ fetchPage, transcriber: fakeTranscriber(), cacheDir, log: quiet });

    await expect(podcasts.latest(PODCASTS.jfa, { limit: 1 })).rejects.toThrow(/HTTP 500/);
  });
});
