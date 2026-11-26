// Publish check: every stat-like number an entry's prose states must be grounded, so a number
// can't reach the site without being checked. Pure: it reads only the entries and the snapshot.
//
// The prose is the title, body, and free-text fields this run wrote (see `prose()`). A number in
// it is grounded when it is:
// - one of the entry's cited stats: nflverse's value as the stat check holds it, rounded to as
//   many decimal places as the prose states (164.7 may read as 165);
// - in the text of a source document the entry cites (its sources, a Film Room entry's link);
// - a score or record the pipeline fills in from the schedule: the entry's final score, a Game
//   Preview's predicted score, the entry's record, or, written as a pair ("35-10", "9-1"), the
//   final score of any game on the schedule or the 49ers' record in a season so far.
//
// Numbers that aren't stats are left out: years (1920 to 2099), dates (Nov. 25, November 25th,
// 11/25, 2026-11-25), clock times (1:25 p.m.), Week numbers (Week 13, Weeks 14-15), quarters
// and downs (4th quarter, 3rd-and-2, Q4), the "49ers" in the team's name, and a Markdown list's
// numbering. Numbers spelled out in words ("three touchdowns") aren't read. Draft rounds and
// picks, jersey numbers, ages, and contract terms are numbers like any other: they pass when a
// cited source states them.
import { seasonRecord } from "../calendar";
import type { CheckFailure, ContentEntry, SourceSnapshot } from "../types";
import { citedUrls, prose, type PublishCheck } from "./check";
import { round } from "./nflverse-stats";

const MONTH = "(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";

/** Spans that hold numbers but no stats. Each is blanked before the numbers are read. */
const NOT_STATS = [
  /\b(?:19[2-9]\d|20\d\d)-\d\d-\d\d\b/g, // an ISO date
  new RegExp(`\\b${MONTH}\\.?\\s+\\d{1,2}(?:st|nd|rd|th)?\\b`, "gi"), // Nov. 25, November 25th
  new RegExp(`\\b\\d{1,2}(?:st|nd|rd|th)?\\s+(?:of\\s+)?${MONTH}\\b`, "gi"), // 25 November
  /\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/g, // 11/25, 11/25/2026
  /\b\d{1,2}:\d{2}\b/g, // 1:25
  /\bweeks?\s+\d+(?:\s*(?:-|–|to|and|through)\s*\d+)?/gi, // Week 13, Weeks 14-15
  /\b\d(?:st|nd|rd|th)\s+(?:quarter|down|and)\b/gi, // 4th quarter, 3rd down
  /\b\d(?:st|nd|rd|th)[-\s](?:and|&)[-\s](?:\d+|goal|inches)\b/gi, // 3rd-and-2
  /\bQ[1-4]\b/g,
  /\b49ers\b/gi,
  /^\s*\d+[.)]\s/gm, // a Markdown list's numbering
  /\b(?:19[2-9]\d|20\d\d)\b/g, // a year
];

/** A number as prose writes it: 35, 2,624, 164.7. Not one glued to a letter before it (Q4, x2). */
const NUMBER = /(?<![\p{L}\d.,])(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?(?![\d])/gu;
/** Two numbers written as a score or a record: 35-10, 9–1. */
const PAIR = /(?<![\p{L}\d.,])(\d{1,3})\s?[-–]\s?(\d{1,3})(?!\d|\.\d)/gu;

export const numbersGrounded: PublishCheck = async ({ entries, snapshot }) => {
  const documents = new Map(snapshot.documents.map((doc) => [doc.url, new Set(numbersIn(doc.text))]));
  const pairs = schedulePairs(snapshot);
  return entries.flatMap((entry): CheckFailure[] => {
    const known = ownNumbers(entry);
    const sourced = new Set(citedUrls(entry).flatMap((url) => [...(documents.get(url) ?? [])]));
    const cited = (("stats" in entry.data && entry.data.stats) || []).map((stat) => stat.value);
    const entryPairs = new Set([...pairs, ...ownPairs(entry)]);
    const grounded = (written: string) => {
      const value = toNumber(written);
      const places = (written.split(".")[1] ?? "").length;
      return known.has(value) || sourced.has(value) || cited.some((stat) => Math.abs(round(stat, places) - value) < 1e-9);
    };

    const seen = new Set<string>();
    return prose(entry, snapshot).flatMap((text) => {
      let rest = NOT_STATS.reduce((t, pattern) => t.replace(pattern, (span) => " ".repeat(span.length)), text);
      rest = rest.replace(PAIR, (span, a: string, b: string) => (entryPairs.has(pairKey(Number(a), Number(b))) ? " ".repeat(span.length) : span));
      return [...rest.matchAll(NUMBER)].flatMap((match): CheckFailure[] => {
        const written = match[0];
        if (grounded(written) || seen.has(written)) return [];
        seen.add(written);
        return [
          {
            check: "numbers",
            entry: entry.path,
            reason: `states ${written} ("${excerpt(text, match.index)}") but it is none of the entry's cited stats and in none of the sources it cites`,
          },
        ];
      });
    });
  });
};

/** Every number in a source's text, as a value. */
function numbersIn(text: string): number[] {
  return [...text.matchAll(NUMBER)].map((match) => toNumber(match[0]));
}

/** Numbers the pipeline filled in on the entry itself: its final score, predicted score, and record. */
function ownNumbers(entry: ContentEntry): Set<number> {
  return new Set(ownScores(entry).flat());
}

function ownPairs(entry: ContentEntry): string[] {
  return ownScores(entry).map(([a, b]) => pairKey(a, b));
}

function ownScores(entry: ContentEntry): [number, number][] {
  const data = entry.data as Record<string, unknown>;
  const scores: [number, number][] = [];
  const score = (value: unknown) => {
    const s = value as { sf?: unknown; opponent?: unknown } | undefined;
    if (typeof s?.sf === "number" && typeof s.opponent === "number") scores.push([s.sf, s.opponent]);
  };
  score(data.result);
  score((data.throughGame as { result?: unknown } | undefined)?.result);
  score((data.prediction as { score?: unknown } | undefined)?.score);
  const record = data.record as { wins: number; losses: number; ties: number } | undefined;
  if (record) scores.push([record.wins, record.losses], [record.ties, record.ties]);
  return scores;
}

/** Final scores on the schedule, and the 49ers' record in each season as of the snapshot's date. */
function schedulePairs(snapshot: SourceSnapshot): string[] {
  const schedule = snapshot.schedule ?? [];
  const results = schedule.flatMap((game) => (game.result ? [pairKey(game.result.sf, game.result.opponent)] : []));
  const records = [...new Set(schedule.map((game) => game.season))].map((season) => {
    const record = seasonRecord(schedule, season, snapshot.date);
    return pairKey(record.wins, record.losses);
  });
  return [...results, ...records];
}

/** The same pair either way round: a score reads 35-10 or 10-35. */
function pairKey(a: number, b: number): string {
  return a >= b ? `${a}-${b}` : `${b}-${a}`;
}

function toNumber(written: string): number {
  return Number(written.replace(/,/g, ""));
}


function excerpt(text: string, at: number): string {
  if (text.length <= 100) return text;
  const start = Math.max(0, at - 45);
  return `${start > 0 ? "…" : ""}${text.slice(start, start + 90).trim()}${start + 90 < text.length ? "…" : ""}`;
}
