// The real source adapter: fetches the Preferred Sources into a source snapshot.
//
// Official 49ers sources (the 49ers.com injury report, transactions, and news feed, and the
// press conference transcripts at 49ers.1rmg.com) are required: if one can't be fetched the
// run fails. NBC Sports Bay Area, ESPN, and the San Francisco Chronicle are best effort: when
// one is blocked or down it is recorded in `snapshot.skipped` and the run goes on.
// Pro Football Reference is never scraped.
//
// Podcasts (49ers Talk, Jonnydel's Football Academy) are best effort too: each show's newest
// episodes from the news window are transcribed through `options.podcasts` (the transcription
// unit in src/podcasts/) and added as documents; a feed or transcription that fails is skipped.
//
// All network access goes through `fetchPage`, which sends one honest bot User-Agent. Tests
// pass a fake `fetchPage` that serves saved captures.
import { PODCASTS, type PodcastTranscripts } from "../../../podcasts";
import type { Job, SkippedSource, SourceAdapter, SourceDocument, SourceSnapshot } from "../../types";
import {
  isBotChallenge,
  pacificToUtc,
  parseArticlePage,
  parseEspnNews,
  parseInjuryReport,
  parseInjuryReportTable,
  parseRssFeed,
  parseSfcSection,
  parseTranscriptListing,
  parseTransactions,
  type FeedItem,
} from "./parsers";

/** The one User-Agent every fetcher and the source-link check send. */
export const BOT_USER_AGENT = "gold-blooded-bot/1.0 (+https://davidmatic.github.io/gold-blooded/)";

export const SOURCE_URLS = {
  injuryReport: "https://www.49ers.com/team/injury-report/",
  transactions: "https://www.49ers.com/team/transactions/",
  ninersNews: "https://www.49ers.com/rss/news",
  transcripts: "https://49ers.1rmg.com/transcripts/",
  nbc: "https://www.nbcsportsbayarea.com/nfl/san-francisco-49ers/feed/",
  espn: "https://site.api.espn.com/apis/site/v2/sports/football/nfl/news?team=25&limit=50",
  sfc: "https://www.sfchronicle.com/sports/49ers/",
} as const;

export interface FetchedPage {
  status: number;
  body: string;
}

/** Fetches one URL. Throws on a network error; any HTTP status is returned. */
export type FetchPage = (url: string) => Promise<FetchedPage>;

export interface RealSourcesOptions {
  fetchPage?: FetchPage;
  /** Article URLs that published News Summaries already cite; they are left out. */
  alreadyCited?: Iterable<string>;
  /** Where progress and fallbacks are reported. Defaults to console.log. */
  log?: (message: string) => void;
  /** Podcast transcripts. Without it, the snapshot has no podcast episodes. */
  podcasts?: PodcastTranscripts;
}

/** Shows transcribed for the daily news, and how many of each show's newest episodes. */
const NEWS_PODCASTS = [PODCASTS.ninersTalk, PODCASTS.jfa];
const MAX_EPISODES_PER_SHOW = 2;

/** Most articles fetched per outlet per run, newest first. */
const MAX_ARTICLES_PER_OUTLET = 8;

export const fetchWithBotUserAgent: FetchPage = async (url) => {
  const response = await fetch(url, {
    headers: { "User-Agent": BOT_USER_AGENT, Accept: "text/html,application/xhtml+xml,application/xml,application/json;q=0.9,*/*;q=0.8" },
    redirect: "follow",
    signal: AbortSignal.timeout(15_000),
  });
  return { status: response.status, body: await response.text() };
};

export function realSources(options: RealSourcesOptions = {}): SourceAdapter {
  const fetchPage = options.fetchPage ?? fetchWithBotUserAgent;
  const log = options.log ?? ((message: string) => console.log(message));
  const cited = new Set(options.alreadyCited ?? []);

  /** A page's body, or an Error saying why it isn't usable. */
  async function load(url: string): Promise<string | Error> {
    try {
      const page = await fetchPage(url);
      if (page.status < 200 || page.status > 299) return new Error(`HTTP ${page.status}`);
      if (!page.body.trim()) return new Error(`HTTP ${page.status} with an empty body`);
      if (isBotChallenge(page.body)) return new Error("served a bot challenge page");
      return page.body;
    } catch (error) {
      return error instanceof Error ? error : new Error(String(error));
    }
  }

  async function required(name: string, url: string): Promise<string> {
    const body = await load(url);
    if (body instanceof Error) throw new Error(`could not fetch ${name} (${url}): ${body.message}`);
    return body;
  }

  /** Fetches each feed item's page for its full text; the feed's description is the fallback. */
  async function articles(outlet: string, items: FeedItem[], window: NewsWindow): Promise<SourceDocument[]> {
    const fresh = items
      .filter((item) => window.contains(item.publishedAt) && !cited.has(item.url))
      .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))
      .slice(0, MAX_ARTICLES_PER_OUTLET);
    return Promise.all(
      fresh.map(async (item) => {
        const body = await load(item.url);
        const page = body instanceof Error ? undefined : parseArticlePage(body);
        if (!page?.text) log(`${outlet}: using the feed description for ${item.url} (${body instanceof Error ? body.message : "no body text"})`);
        return { url: item.url, outlet, title: item.title, publishedAt: item.publishedAt, text: page?.text || item.summary };
      }),
    );
  }

  async function bestEffort<T>(outlet: string, skipped: SkippedSource[], collect: () => Promise<T[]>): Promise<T[]> {
    try {
      return await collect();
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      log(`${outlet}: skipped (${reason})`);
      skipped.push({ outlet, reason });
      return [];
    }
  }

  /** A best-effort outlet's index page, throwing (to be caught by bestEffort) when unusable. */
  async function index(url: string): Promise<string> {
    const body = await load(url);
    if (body instanceof Error) throw body;
    return body;
  }

  return {
    async collect(job: Job): Promise<SourceSnapshot> {
      if (job.type !== "daily-news") throw new Error(`the real sources don't collect for "${job.type}" yet`);
      const window = newsWindow(job.date);

      const [injuryHtml, transactionsHtml, newsFeed, transcriptsHtml] = await Promise.all([
        required("the 49ers.com injury report", SOURCE_URLS.injuryReport),
        required("the 49ers.com transactions", SOURCE_URLS.transactions),
        required("the 49ers.com news feed", SOURCE_URLS.ninersNews),
        required("the 49ers press conference transcripts", SOURCE_URLS.transcripts),
      ]);

      const documents: SourceDocument[] = [];
      documents.push(injuryReportDocument(injuryHtml, job.date));
      const transactions = transactionsDocument(transactionsHtml, job.date, window);
      if (transactions) documents.push(transactions);
      documents.push(...(await transcripts(transcriptsHtml, window)));
      documents.push(...(await articles("49ers.com", parseRssFeed(newsFeed), window)));

      const skipped: SkippedSource[] = [];
      const [nbc, espn, sfc] = await Promise.all([
        bestEffort("NBC Sports Bay Area", skipped, async () =>
          articles("NBC Sports Bay Area", parseRssFeed(await index(SOURCE_URLS.nbc)), window),
        ),
        bestEffort("ESPN", skipped, async () => articles("ESPN", parseEspnNews(await index(SOURCE_URLS.espn)), window)),
        bestEffort("San Francisco Chronicle", skipped, async () => sfChronicle(parseSfcSection(await index(SOURCE_URLS.sfc)), window)),
      ]);
      documents.push(...nbc, ...espn, ...sfc);
      if (options.podcasts) documents.push(...(await podcastEpisodes(options.podcasts, window, skipped)));
      // Keep the order stable whatever finished first.
      skipped.sort((a, b) => OUTLET_ORDER.indexOf(a.outlet) - OUTLET_ORDER.indexOf(b.outlet));

      return {
        date: job.date,
        documents,
        injuryReport: parseInjuryReport(injuryHtml),
        ...(skipped.length > 0 && { skipped }),
      };
    },

    async linkResolves(url: string): Promise<boolean> {
      return !((await load(url)) instanceof Error);
    },
  };

  /** One show at a time: transcription is CPU-bound on the runner. */
  async function podcastEpisodes(podcasts: PodcastTranscripts, window: NewsWindow, skipped: SkippedSource[]): Promise<SourceDocument[]> {
    const documents: SourceDocument[] = [];
    for (const podcast of NEWS_PODCASTS) {
      const episodes = await bestEffort(podcast.show, skipped, async () =>
        podcasts.latest(podcast, { limit: MAX_EPISODES_PER_SHOW, from: window.from, to: window.to, exclude: cited }),
      );
      for (const episode of episodes) {
        if (!episode.transcript) {
          const reason = `could not transcribe "${episode.title}": ${episode.transcriptError ?? "no transcript"}`;
          skipped.push({ outlet: podcast.show, reason });
          continue;
        }
        documents.push({
          url: episode.episodeUrl,
          outlet: episode.show,
          title: episode.title,
          publishedAt: episode.publishedAt,
          text: episode.transcript,
          podcast: { show: episode.show, hosts: episode.hosts },
        });
      }
    }
    return documents;
  }

  async function transcripts(listingHtml: string, window: NewsWindow): Promise<SourceDocument[]> {
    const listed = parseTranscriptListing(listingHtml).filter((t) => window.containsDay(t.date) && !cited.has(t.url));
    const documents = await Promise.all(
      listed.map(async (transcript): Promise<SourceDocument[]> => {
        const body = await load(transcript.url);
        const text = body instanceof Error ? "" : parseArticlePage(body).text;
        if (!text) {
          log(`49ers.com: skipped transcript ${transcript.url} (${body instanceof Error ? body.message : "no text"})`);
          return [];
        }
        const publishedAt = dayStart(transcript.date).toISOString();
        return [{ url: transcript.url, outlet: "49ers.com", title: transcript.title, publishedAt, text }];
      }),
    );
    return documents.flat();
  }

  /** The SF Chronicle section has no dates, so each article page supplies its own. */
  async function sfChronicle(links: string[], window: NewsWindow): Promise<SourceDocument[]> {
    const documents = await Promise.all(
      links
        .filter((url) => !cited.has(url))
        .slice(0, MAX_ARTICLES_PER_OUTLET)
        .map(async (url): Promise<SourceDocument[]> => {
          const body = await load(url);
          if (body instanceof Error) {
            log(`San Francisco Chronicle: skipped ${url} (${body.message})`);
            return [];
          }
          const page = parseArticlePage(body);
          if (!page.text || !page.publishedAt || !window.contains(page.publishedAt)) return [];
          return [{ url, outlet: "San Francisco Chronicle", title: page.title, publishedAt: page.publishedAt, text: page.text }];
        }),
    );
    return documents.flat();
  }
}

const OUTLET_ORDER = ["NBC Sports Bay Area", "ESPN", "San Francisco Chronicle", ...NEWS_PODCASTS.map((p) => p.show)];

/** The official injury report, written out as a document the writer can read and cite. */
function injuryReportDocument(html: string, date: string): SourceDocument {
  const { week, rows } = parseInjuryReportTable(html);
  const day = (status: string) => status || "none";
  const lines = rows.map(
    (row) =>
      `${row.player} (${row.position}, ${row.injury}). Wed: ${day(row.practice.wed)}. Thu: ${day(row.practice.thu)}. ` +
      `Fri: ${day(row.practice.fri)}. Game status: ${/^(unspecified)?$/i.test(row.gameStatus) ? "none yet" : row.gameStatus}.`,
  );
  return {
    url: SOURCE_URLS.injuryReport,
    outlet: "49ers.com",
    title: week ? `49ers injury report (${week})` : "49ers injury report",
    publishedAt: dayStart(date).toISOString(),
    text: [
      "Official San Francisco 49ers injury report. Practice: DNP = did not participate, LP = limited, FP = full.",
      ...(lines.length > 0 ? lines : ["No players listed."]),
    ].join("\n"),
  };
}

function transactionsDocument(html: string, date: string, window: NewsWindow): SourceDocument | undefined {
  const recent = parseTransactions(html, date).filter((t) => window.containsDay(t.date));
  if (recent.length === 0) return undefined;
  return {
    url: SOURCE_URLS.transactions,
    outlet: "49ers.com",
    title: "49ers transactions",
    publishedAt: dayStart(recent[0]!.date).toISOString(),
    text: recent.map((t) => `${t.date}: ${t.text}`).join("\n"),
  };
}

interface NewsWindow {
  /** The window's start and end instants (ISO 8601, end exclusive). */
  from: string;
  to: string;
  contains(isoInstant: string): boolean;
  containsDay(day: string): boolean;
}

/** A daily run covers the job's day and the day before, in the team's time zone. */
function newsWindow(date: string): NewsWindow {
  const previous = addDays(date, -1);
  const start = dayStart(previous).getTime();
  const end = dayStart(addDays(date, 1)).getTime();
  return {
    from: new Date(start).toISOString(),
    to: new Date(end).toISOString(),
    contains: (instant) => {
      const t = Date.parse(instant);
      return t >= start && t < end;
    },
    containsDay: (day) => day === date || day === previous,
  };
}

/** Midnight at the start of a YYYY-MM-DD day, Pacific time. */
function dayStart(day: string): Date {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  return pacificToUtc(y, m - 1, d);
}

function addDays(day: string, days: number): string {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}
