// How the Purdy Shrine reads on the site: which Love Letter is newest, the stat tracker's tables
// (each season, his career, and this season's game log with DNP games), and the slot for his
// Film Room entries.
import type { CitedStat, StatScope } from "../content/cited-stat";
import { PURDY, TRACKER_COLUMNS, TRACKER_RATES, type LoveLetterData, type LoveLetterVariant, type PurdyStatTrackerData } from "../content/purdy-shrine";
import { gameWeekName, matchup, resultLine } from "./game-weeks";
import { formatStat } from "./stat-breakdown";

/** Love Letters, newest first (by the game they're about). */
export function loveLettersNewestFirst<T extends { data: LoveLetterData }>(letters: readonly T[]): T[] {
  return [...letters].sort((a, b) => b.data.date.localeCompare(a.data.date) || b.data.season - a.data.season || b.data.week - a.data.week);
}

/** The newest Love Letter, for the homepage and the top of the Shrine. */
export function newestLoveLetter<T extends { data: LoveLetterData }>(letters: readonly T[]): T | undefined {
  return loveLettersNewestFirst(letters)[0];
}

/** "Love Letter", or "We miss you" for the letter written when he didn't play. */
export function variantLabel(variant: LoveLetterVariant): string {
  return variant === "we-miss-you" ? "We miss you" : "Love Letter";
}

/** "2026 Week 10, at DAL, won 46-40". */
export function letterGameLine(data: LoveLetterData): string {
  return `${gameWeekName(data)}, ${matchup(data)}, ${resultLine(data.result)}`;
}

/** The tracker's column headings after the games columns. */
export const TRACKER_HEADINGS = TRACKER_COLUMNS.map(([, label]) => label);

export interface TrackerRow {
  label: string;
  games: number;
  played: number;
  dnp: number;
  values: string[];
}

/** One row per season since 2022, then his career. */
export function trackerSeasonRows(data: PurdyStatTrackerData): { seasons: TrackerRow[]; career: TrackerRow } {
  const seasons = data.seasons.map((row) => ({ label: String(row.season), ...row, values: values(data.stats, { type: "season", season: row.season }) }));
  const sum = (key: "games" | "played" | "dnp") => data.seasons.reduce((total, row) => total + row[key], 0);
  const first = data.seasons[0]?.season ?? PURDY.firstSeason;
  return {
    seasons,
    career: { label: "Career", games: sum("games"), played: sum("played"), dnp: sum("dnp"), values: values(data.stats, { type: "seasons", from: first, to: data.season }) },
  };
}

export interface GameLogRow {
  gameWeek: string;
  name: string;
  matchup: string;
  result: string;
  /** False is a DNP. */
  played: boolean;
  /** His line, by TRACKER_HEADINGS ("–" for the rates, which a single game's log leaves out). */
  values: string[];
}

/** This season's games, in order, each with his line or DNP. */
export function gameLogRows(data: PurdyStatTrackerData): GameLogRow[] {
  return data.gameLog.map((game) => {
    const result = resultLine(game.result);
    return {
      gameWeek: game.gameWeek,
      name: gameWeekName({ season: data.season, week: game.week, gameType: game.gameType }).replace(/^\d{4} /, ""),
      matchup: matchup(game),
      result: result.charAt(0).toUpperCase() + result.slice(1),
      played: game.played,
      values: game.played ? values(data.stats, { type: "game", gameId: game.gameId }) : [],
    };
  });
}

function values(stats: readonly CitedStat[], scope: StatScope): string[] {
  const same = (other: StatScope) => Object.entries(scope).every(([key, value]) => (other as Record<string, unknown>)[key] === value) && Object.keys(other).length === Object.keys(scope).length;
  return TRACKER_COLUMNS.map(([column]) => {
    const stat = stats.find((s) => s.stat === column && !s.per && same(s.scope));
    if (!stat) return "–";
    return TRACKER_RATES.includes(column) ? stat.value.toFixed(1) : formatStat(stat.value);
  });
}

/**
 * A Purdy-related Film Room entry, as the Shrine lists it. The slot for ticket #12: the Film Room
 * maps its Purdy-tagged entries to these, newest first, and the Shrine shows them under "Purdy
 * in the Film Room" (src/components/PurdyFilmRoom.astro). Until then the list is empty and the
 * section isn't shown.
 */
export interface ShrineFilmRoomEntry {
  title: string;
  /** The show or channel it is credited to, e.g. "The QB School". */
  show: string;
  /** The Film Room entry's page on this site. */
  href: string;
  /** The original video or episode. */
  sourceUrl: string;
  date: string;
  summary?: string;
}
