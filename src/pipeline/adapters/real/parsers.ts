// Pure parsers for the real source adapter: raw pages, feeds, and JSON in, snapshot pieces out.
// Nothing here touches the network, so each parser is tested against saved captures in
// test/fixtures/sources/.
import { XMLParser } from "fast-xml-parser";
import { parse as parseHtml, type HTMLElement } from "node-html-parser";
import { GAME_STATUSES, PRACTICE_STATUSES } from "../../../content/news-summary";
import type { GameStatus, InjuryReportEntry, PracticeStatus } from "../../types";

/**
 * The 49ers.com injury report table (team/injury-report/). Columns: Player, Position, Injury,
 * Wed, Thu, Fri, Game Status. A player's practice status is the latest day that has one;
 * the game status is left out while the page shows UNSPECIFIED (before the final report).
 */
export function parseInjuryReport(html: string): InjuryReportEntry[] {
  return parseInjuryReportTable(html).rows.map(({ player, practice, gameStatus: raw }) => {
    const practiceStatus = [practice.fri, practice.thu, practice.wed].map(asPracticeStatus).find(Boolean);
    const gameStatus = asGameStatus(raw);
    return { player, ...(practiceStatus && { practiceStatus }), ...(gameStatus && { gameStatus }) };
  });
}

/** One row of the 49ers.com injury report table, as printed. */
export interface InjuryReportRow {
  player: string;
  position: string;
  injury: string;
  practice: { wed: string; thu: string; fri: string };
  /** As printed: "UNSPECIFIED" until the final report, then e.g. "QUESTIONABLE". */
  gameStatus: string;
}

/** The injury report table, plus the week the page is showing (e.g. "Week 12"). */
export function parseInjuryReportTable(html: string): { week?: string; rows: InjuryReportRow[] } {
  const root = parseHtml(html);
  const week = root.querySelector('option[value*="/injury-report/week/"][selected]')?.text.trim();
  const rows = (root.querySelector(".nfl-o-injury-report table")?.querySelectorAll("tbody tr") ?? []).flatMap(
    (row): InjuryReportRow[] => {
      const cells = row.querySelectorAll("td").map(cellText);
      if (cells.length < 7) return [];
      const player = row.querySelector(".d3-o-player-roster__player-name")?.text.trim() || cells[0]!;
      const [, position, injury, wed, thu, fri, gameStatus] = cells as [string, string, string, string, string, string, string];
      return [{ player, position, injury, practice: { wed, thu, fri }, gameStatus }];
    },
  );
  return { ...(week && { week: titleCase(week) }), rows };
}

function titleCase(value: string): string {
  return value.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());
}

function asPracticeStatus(value: string): PracticeStatus | undefined {
  return PRACTICE_STATUSES.find((status) => status === value.toUpperCase());
}

function asGameStatus(value: string): GameStatus | undefined {
  return GAME_STATUSES.find((status) => status.toLowerCase() === value.toLowerCase());
}

function cellText(cell: HTMLElement): string {
  return cell.text.replace(/\s+/g, " ").trim();
}

export interface Transaction {
  /** YYYY-MM-DD. */
  date: string;
  text: string;
}

/**
 * The 49ers.com transactions page (team/transactions/): month tables of "MM/DD | description".
 * The page gives no year, so a month after the job's month belongs to the previous year.
 */
export function parseTransactions(html: string, jobDate: string): Transaction[] {
  const [jobYear, jobMonth] = jobDate.split("-").map(Number) as [number, number];
  return parseHtml(html)
    .querySelectorAll(".nfl-c-transactions-report tbody tr")
    .flatMap((row): Transaction[] => {
      const [dateCell, textCell] = row.querySelectorAll("td");
      const date = dateCell?.text.trim().match(/^(\d{1,2})\/(\d{1,2})$/);
      const text = textCell ? cellText(textCell) : "";
      if (!date || !text) return [];
      const [month, day] = [Number(date[1]), Number(date[2])];
      const year = month > jobMonth ? jobYear - 1 : jobYear;
      return [{ date: `${year}-${pad(month)}-${pad(day)}`, text }];
    });
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** One item from a news feed or listing, before its full text is fetched. */
export interface FeedItem {
  url: string;
  title: string;
  /** ISO 8601, UTC. */
  publishedAt: string;
  /** The feed's own description, as plain text. */
  summary: string;
}

const xml = new XMLParser({
  ignoreAttributes: true,
  processEntities: true,
  htmlEntities: true,
  parseTagValue: false,
  isArray: (name) => name === "item",
});

/**
 * An RSS 2.0 feed (49ers.com news, NBC Sports Bay Area). Spanish-language 49ers.com items
 * are dropped. Items without a link or a readable date are skipped.
 */
export function parseRssFeed(feed: string): FeedItem[] {
  const items: Record<string, unknown>[] = xml.parse(feed)?.rss?.channel?.item ?? [];
  return items.flatMap((item): FeedItem[] => {
    const url = text(item.link);
    const publishedAt = parseFeedDate(text(item.pubDate));
    if (!url || !publishedAt) return [];
    if (/(^|[\s,])(spanish|español)([\s,]|$)/i.test(text(item["media:keywords"]))) return [];
    return [{ url, title: plain(text(item.title)), publishedAt, summary: plain(text(item.description)) }];
  });
}

/** A transcript on the 49ers media center listing (49ers.1rmg.com/transcripts/). */
export interface TranscriptLink {
  url: string;
  title: string;
  /** YYYY-MM-DD, as the listing dates it. */
  date: string;
}

/** The transcript listing, newest first. Slugs are irregular, so links come from the page. */
export function parseTranscriptListing(html: string): TranscriptLink[] {
  return parseHtml(html)
    .querySelectorAll("table.document-table tr")
    .flatMap((row): TranscriptLink[] => {
      const link = row.querySelector("a[href]");
      const date = row.querySelector("small")?.text.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{2})$/);
      if (!link || !date) return [];
      const [, month, day, year] = date;
      return [
        {
          url: new URL(link.getAttribute("href")!, "https://49ers.1rmg.com/").href,
          title: cellText(link),
          date: `20${year}-${month!.padStart(2, "0")}-${day!.padStart(2, "0")}`,
        },
      ];
    });
}

/** What an article or transcript page holds: its headline, publish time, and full text. */
export interface ArticlePage {
  title: string;
  publishedAt?: string;
  /** The body, one paragraph per line, text as published (entities decoded). */
  text: string;
}

// Where each outlet keeps its body paragraphs, most specific first. The first selector that
// finds any paragraphs wins.
const BODY_SELECTORS = [
  ".nfl-c-article__body p", // 49ers.com
  ".article-body p", // ESPN
  ".article-content p", // NBC Sports Bay Area
  ".page-content .container > p, .page-content .container > div", // 49ers.1rmg.com transcripts
  "[data-block-type] p", // SF Chronicle
  "article p",
];

export function parseArticlePage(html: string): ArticlePage {
  const root = parseHtml(html);
  let paragraphs: string[] = [];
  for (const selector of BODY_SELECTORS) {
    paragraphs = root.querySelectorAll(selector).map(cellText).filter(Boolean);
    if (paragraphs.length > 0) break;
  }
  const title =
    root.querySelector('meta[property="og:title"]')?.getAttribute("content")?.trim() ||
    root.querySelector("title")?.text.trim() ||
    "";
  const published =
    root.querySelector('meta[property="article:published_time"]')?.getAttribute("content") ??
    html.match(/"datePublished"\s*:\s*"([^"]+)"/)?.[1];
  const publishedAt = published ? parseFeedDate(published) : undefined;
  return { title, ...(publishedAt && { publishedAt }), text: paragraphs.join("\n") };
}

/** The SF Chronicle 49ers section's article links, absolute and once each. */
export function parseSfcSection(html: string): string[] {
  const hrefs = parseHtml(html)
    .querySelectorAll('a[href*="/sports/49ers/article/"]')
    .map((a) => new URL(a.getAttribute("href")!, "https://www.sfchronicle.com/").href);
  return [...new Set(hrefs)];
}

/**
 * Whether a page is a bot wall rather than content (SF Chronicle's "Client Challenge",
 * Cloudflare's "Just a moment...", Akamai's "Access Denied"). Such a page can come back 200.
 */
export function isBotChallenge(html: string): boolean {
  const title = parseHtml(html).querySelector("title")?.text.trim() ?? "";
  return /^(client challenge|just a moment|attention required|access denied)/i.test(title);
}

interface EspnArticle {
  headline?: string;
  description?: string;
  published?: string;
  type?: string;
  links?: { web?: { href?: string } };
  categories?: { type?: string; description?: string }[];
}

/**
 * ESPN's team news JSON (site.api.espn.com .../nfl/news?team=25). Keeps written stories
 * about the 49ers: drops video clips, game previews and recaps, betting pieces, and
 * league-wide posts that tag many teams.
 */
export function parseEspnNews(json: string): FeedItem[] {
  const articles: EspnArticle[] = JSON.parse(json).articles ?? [];
  return articles.flatMap((article): FeedItem[] => {
    const url = article.links?.web?.href;
    const publishedAt = article.published ? parseFeedDate(article.published) : undefined;
    const teams = (article.categories ?? []).filter((category) => category.type === "team").map((c) => c.description);
    if (!url || !publishedAt || !article.headline) return [];
    if (article.type !== "Story" && article.type !== "HeadlineNews") return [];
    if (!/\/story\//.test(url) || /\/betting\//.test(url)) return [];
    if (!teams.includes("San Francisco 49ers") || teams.length > 2) return [];
    return [{ url, title: article.headline, publishedAt, summary: article.description ?? "" }];
  });
}

/**
 * A feed date as ISO 8601. Handles RFC 822 dates and NBC Sports Bay Area's
 * "Wed, Nov 25 2026 06:36:28 PM", which carries no zone and is Pacific time.
 */
export function parseFeedDate(value: string): string | undefined {
  const nbc = value.match(/^\w{3}, (\w{3}) (\d{1,2}) (\d{4}) (\d{1,2}):(\d{2}):(\d{2}) (AM|PM)$/);
  if (nbc) {
    const [, mon, day, year, hour, minute, second, half] = nbc;
    const month = MONTHS.indexOf(mon!.toLowerCase());
    if (month < 0) return undefined;
    const h = (Number(hour) % 12) + (half === "PM" ? 12 : 0);
    return pacificToUtc(Number(year), month, Number(day), h, Number(minute), Number(second)).toISOString();
  }
  const date = new Date(value);
  return value && !Number.isNaN(date.getTime()) ? date.toISOString() : undefined;
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/** The UTC instant of a wall-clock time in the team's time zone (America/Los_Angeles). */
export function pacificToUtc(year: number, month: number, day: number, hour = 0, minute = 0, second = 0): Date {
  const wall = Date.UTC(year, month, day, hour, minute, second);
  const guess = wall - pacificOffsetMs(new Date(wall));
  // Recompute at the guess, in case a DST change lies between the two.
  return new Date(wall - pacificOffsetMs(new Date(guess)));
}

const pacific = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Los_Angeles",
  hourCycle: "h23",
  year: "numeric",
  month: "numeric",
  day: "numeric",
  hour: "numeric",
  minute: "numeric",
  second: "numeric",
});

/** Pacific wall-clock time minus UTC at an instant (negative: -8h or -7h). */
function pacificOffsetMs(instant: Date): number {
  const parts = Object.fromEntries(pacific.formatToParts(instant).map((part) => [part.type, Number(part.value)]));
  const wall = Date.UTC(parts.year!, parts.month! - 1, parts.day!, parts.hour!, parts.minute!, parts.second!);
  return wall - Math.floor(instant.getTime() / 1000) * 1000;
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : typeof value === "number" ? String(value) : "";
}

/** HTML (or entity-encoded text) as plain text with collapsed whitespace. */
function plain(html: string): string {
  return parseHtml(html).text.replace(/\s+/g, " ").trim();
}
