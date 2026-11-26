// The real source adapter, driven through its SourceAdapter interface with a fake page
// fetcher that serves the saved captures in test/fixtures/sources/. No network.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { realSources, SOURCE_URLS, type FetchPage } from "../../src/pipeline/adapters/real/sources";
import { PODCASTS, type LatestOptions, type Podcast, type PodcastEpisode, type PodcastTranscripts } from "../../src/podcasts";

const fixture = (name: string) => readFileSync(new URL(`../fixtures/sources/${name}`, import.meta.url), "utf8");

const SHANAHAN = "https://49ers.1rmg.com/transcripts/head-coach-kyle-shanahan-press-conference-64/";
const MORRIS = "https://49ers.1rmg.com/transcripts/defensive-coordinator-raheem-morris-press-conference_11-25-26/";
const POTW = "https://www.49ers.com/news/brock-purdy-named-nfc-offensive-player-of-the-week-following-mexico-city-win";
const HOBBS = "https://www.49ers.com/news/49ers-activate-cb-nate-hobbs-place-ol-colton-mckivitz-on-the-injured-reserve-list";
const BOSA = "https://www.nbcsportsbayarea.com/nfl/san-francisco-49ers/nick-bosa-mexico-city-cheering/1983216/";
const ESPN_PURDY = "https://www.espn.com/nfl/story/_/id/50596930/49ers-brock-purdy-ankle-injury-practice-wednesday";
const SFC_PURDY = "https://www.sfchronicle.com/sports/49ers/article/49ers-qb-brock-purdy-misses-practice-ankle-injury-22550058.php";

const PAGES: Record<string, string> = {
  [SOURCE_URLS.injuryReport]: "49ers-injury-report.html",
  [SOURCE_URLS.transactions]: "49ers-transactions.html",
  [SOURCE_URLS.ninersNews]: "49ers-news.xml",
  [SOURCE_URLS.transcripts]: "1rmg-transcripts.html",
  [SOURCE_URLS.nbc]: "nbc-49ers.xml",
  [SOURCE_URLS.espn]: "espn-49ers-news.json",
  [SOURCE_URLS.sfc]: "sfc-section.html",
  [SHANAHAN]: "1rmg-transcript-shanahan.html",
  [POTW]: "49ers-article.html",
  [BOSA]: "nbc-article.html",
  [ESPN_PURDY]: "espn-story.html",
  [SFC_PURDY]: "sfc-article.html",
};

/** Serves the fixtures; any other URL is a 404. `overrides` replace a URL's response. */
function fakeFetch(overrides: Record<string, { status: number; body: string } | Error> = {}): FetchPage {
  return async (url) => {
    const override = overrides[url];
    if (override instanceof Error) throw override;
    if (override) return override;
    const file = PAGES[url];
    return file ? { status: 200, body: fixture(file) } : { status: 404, body: "Not found" };
  };
}

const job = { type: "daily-news" as const, date: "2026-11-25" };
const quiet = () => {};

describe("real sources: collecting the daily news snapshot", () => {
  it("puts the official injury report in the snapshot as structured lines", async () => {
    const snapshot = await realSources({ fetchPage: fakeFetch(), log: quiet }).collect(job);

    expect(snapshot.date).toBe("2026-11-25");
    expect(snapshot.injuryReport).toHaveLength(15);
    expect(snapshot.injuryReport).toContainEqual({ player: "Brock Purdy", practiceStatus: "DNP" });
  });

  it("also files the injury report and the day's transactions as documents", async () => {
    const { documents } = await realSources({ fetchPage: fakeFetch(), log: quiet }).collect(job);

    const report = documents.find((doc) => doc.url === SOURCE_URLS.injuryReport);
    expect(report).toMatchObject({ outlet: "49ers.com", title: "49ers injury report (Week 12)" });
    expect(report!.text).toContain("Brock Purdy (QB, Ankle). Wed: DNP. Thu: none. Fri: none. Game status: none yet.");

    const transactions = documents.find((doc) => doc.url === SOURCE_URLS.transactions);
    expect(transactions!.text).toContain("2026-11-25: The 49ers have activated CB Nate Hobbs");
    expect(transactions!.text).not.toContain("2026-11-21");
  });

  it("keeps each article's and transcript's full text", async () => {
    const { documents } = await realSources({ fetchPage: fakeFetch(), log: quiet }).collect(job);
    const byUrl = new Map(documents.map((doc) => [doc.url, doc]));

    expect(byUrl.get(SHANAHAN)).toMatchObject({ outlet: "49ers.com", title: "Head Coach Kyle Shanahan Press Conference" });
    expect(byUrl.get(SHANAHAN)!.text).toContain("“We’ll see. Concern today, couldn’t go.”");
    expect(byUrl.get(POTW)!.text).toContain("Purdy completed 21-of-26 passes (80.8 percent) for 255 yards");
    expect(byUrl.get(BOSA)).toMatchObject({ outlet: "NBC Sports Bay Area" });
    expect(byUrl.get(BOSA)!.text).toContain("“I thought it was good,” Bosa said Wednesday");
    expect(byUrl.get(ESPN_PURDY)).toMatchObject({ outlet: "ESPN", publishedAt: "2026-11-26T00:16:10.000Z" });
    expect(byUrl.get(ESPN_PURDY)!.text).toContain("Brock Purdy did not practice Wednesday");
    expect(byUrl.get(SFC_PURDY)).toMatchObject({ outlet: "San Francisco Chronicle", publishedAt: "2026-11-25T23:15:46.000Z" });
  });

  it("only takes news from the job's day and the day before", async () => {
    const { documents } = await realSources({ fetchPage: fakeFetch(), log: quiet }).collect(job);
    const urls = documents.map((doc) => doc.url);

    // ESPN's Darnold story is from Nov 23 (Pacific).
    expect(urls).not.toContain("https://www.espn.com/nfl/story/_/id/50578357/seahawks-holding-final-sam-darnold-call-vs-49ers");
    // The Nov 20 Shanahan transcript.
    expect(urls).not.toContain("https://49ers.1rmg.com/transcripts/head-coach-kyle-shanahan-press-conference_11-20-26/");
  });

  it("falls back to the feed's description when an article page doesn't load", async () => {
    const { documents } = await realSources({ fetchPage: fakeFetch(), log: quiet }).collect(job);

    expect(documents.find((doc) => doc.url === HOBBS)?.text).toMatch(/Nate Hobbs/);
  });

  it("skips a transcript whose page doesn't load", async () => {
    const { documents } = await realSources({ fetchPage: fakeFetch(), log: quiet }).collect(job);

    expect(documents.map((doc) => doc.url)).not.toContain(MORRIS);
  });

  it("leaves out articles that published News Summaries already cite", async () => {
    const { documents } = await realSources({ fetchPage: fakeFetch(), log: quiet, alreadyCited: [POTW] }).collect(job);

    expect(documents.map((doc) => doc.url)).not.toContain(POTW);
  });

  it("skips the SF Chronicle, without failing, when it serves its bot challenge", async () => {
    const challenge = { status: 200, body: fixture("sfc-challenge.html") };
    const snapshot = await realSources({ fetchPage: fakeFetch({ [SOURCE_URLS.sfc]: challenge }), log: quiet }).collect(job);

    expect(snapshot.documents.some((doc) => doc.outlet === "San Francisco Chronicle")).toBe(false);
    expect(snapshot.skipped).toEqual([{ outlet: "San Francisco Chronicle", reason: "served a bot challenge page" }]);
    expect(snapshot.documents.some((doc) => doc.outlet === "ESPN")).toBe(true);
  });

  it("skips ESPN and NBC Sports Bay Area, without failing, when they block or fail", async () => {
    const snapshot = await realSources({
      fetchPage: fakeFetch({ [SOURCE_URLS.espn]: { status: 403, body: "Access Denied" }, [SOURCE_URLS.nbc]: new Error("timeout") }),
      log: quiet,
    }).collect(job);

    expect(snapshot.skipped).toEqual([
      { outlet: "NBC Sports Bay Area", reason: "timeout" },
      { outlet: "ESPN", reason: "HTTP 403" },
    ]);
    expect(snapshot.injuryReport).toHaveLength(15);
  });

  it("fails the run when an official 49ers source can't be fetched", async () => {
    const sources = realSources({ fetchPage: fakeFetch({ [SOURCE_URLS.injuryReport]: { status: 500, body: "" } }), log: quiet });

    await expect(sources.collect(job)).rejects.toThrow(/49ers.com injury report.*HTTP 500/);
  });
});

const TALK_EPISODE = "https://podcasts.apple.com/us/podcast/brock-purdy-misses-practice/id1153457233?i=1000804108161";
const JFA_EPISODE = "https://www.buzzsprout.com/2047939/episodes/20168779";

function episode(podcast: Podcast, overrides: Partial<PodcastEpisode>): PodcastEpisode {
  return {
    podcastId: podcast.id,
    show: podcast.show,
    hosts: [...podcast.hosts],
    guid: "guid",
    title: "An episode",
    publishedAt: "2026-11-26T02:32:18.000Z",
    episodeUrl: "https://example.com/episode",
    audioUrl: "https://example.com/episode.mp3",
    description: "Show notes.",
    ...overrides,
  };
}

/** Stands in for the transcription unit: serves canned episodes per show, and records what it was asked. */
function fakePodcasts(byShow: Record<string, PodcastEpisode[] | Error>): PodcastTranscripts & { asked: [string, LatestOptions][] } {
  const asked: [string, LatestOptions][] = [];
  return {
    asked,
    async latest(podcast, options) {
      asked.push([podcast.id, options]);
      const episodes = byShow[podcast.id] ?? [];
      if (episodes instanceof Error) throw episodes;
      return episodes;
    },
  };
}

describe("real sources: podcast transcripts", () => {
  const talk = episode(PODCASTS.ninersTalk, {
    title: "Brock Purdy misses practice as 49ers prepare to face desperate Seahawks",
    episodeUrl: TALK_EPISODE,
    transcript: "Maiocco: I think Purdy plays on Sunday.",
  });

  it("adds each transcribed episode as a document crediting its show and hosts", async () => {
    const podcasts = fakePodcasts({ [PODCASTS.ninersTalk.id]: [talk] });
    const { documents } = await realSources({ fetchPage: fakeFetch(), podcasts, log: quiet }).collect(job);

    expect(documents.find((doc) => doc.url === TALK_EPISODE)).toEqual({
      url: TALK_EPISODE,
      outlet: "49ers Talk",
      title: "Brock Purdy misses practice as 49ers prepare to face desperate Seahawks",
      publishedAt: "2026-11-26T02:32:18.000Z",
      text: "Maiocco: I think Purdy plays on Sunday.",
      podcast: { show: "49ers Talk", hosts: ["Matt Maiocco", "Jennifer Lee Chan"] },
    });
  });

  it("asks both shows for their newest two episodes from the job's day and the day before, leaving out cited ones", async () => {
    const podcasts = fakePodcasts({});
    await realSources({ fetchPage: fakeFetch(), podcasts, alreadyCited: [JFA_EPISODE], log: quiet }).collect(job);

    expect(podcasts.asked.map(([id]) => id)).toEqual(["49ers-talk", "jfa"]);
    for (const [, options] of podcasts.asked) {
      expect(options).toMatchObject({ limit: 2, from: "2026-11-24T08:00:00.000Z", to: "2026-11-26T08:00:00.000Z" });
      expect([...(options.exclude ?? [])]).toContain(JFA_EPISODE);
    }
  });

  it("skips, without failing, an episode that couldn't be transcribed and a feed that couldn't be read", async () => {
    const untranscribed = episode(PODCASTS.ninersTalk, { title: "Lynch extension", transcriptError: "whisper crashed" });
    const podcasts = fakePodcasts({ [PODCASTS.ninersTalk.id]: [untranscribed], [PODCASTS.jfa.id]: new Error("HTTP 503") });
    const snapshot = await realSources({ fetchPage: fakeFetch(), podcasts, log: quiet }).collect(job);

    expect(snapshot.documents.some((doc) => doc.podcast)).toBe(false);
    expect(snapshot.skipped).toEqual(
      expect.arrayContaining([
        { outlet: "49ers Talk", reason: 'could not transcribe "Lynch extension": whisper crashed' },
        { outlet: "Jonnydel's Football Academy", reason: "HTTP 503" },
      ]),
    );
  });
});

describe("real sources: the source-link check", () => {
  const sources = realSources({
    fetchPage: fakeFetch({
      "https://example.com/espn-bot-wall": { status: 202, body: "" },
      "https://example.com/challenge": { status: 200, body: fixture("sfc-challenge.html") },
      "https://example.com/down": new Error("ECONNREFUSED"),
    }),
    log: quiet,
  });

  it("counts a page that loads with content as resolved", async () => {
    expect(await sources.linkResolves(POTW)).toBe(true);
  });

  it.each([
    ["a 404", "https://example.com/missing"],
    ["a 202 with an empty body", "https://example.com/espn-bot-wall"],
    ["a bot challenge page", "https://example.com/challenge"],
    ["a network error", "https://example.com/down"],
  ])("does not count %s as resolved", async (_, url) => {
    expect(await sources.linkResolves(url)).toBe(false);
  });
});
