// How the post-game job's content reads on the site: each Highlights standout's stat line, and
// the Season Stats tables.
import type { CitedStat } from "../content/cited-stat";
import type { HighlightsData } from "../content/game-week";
import type { SeasonStatsData } from "../content/season-stats";
import { formatStat } from "./stat-breakdown";

export interface Standout {
  player: string;
  team: string;
  writeUp: string;
  /** "255 passing yards, 3 passing TDs". */
  statLine: string;
}

/** The standouts, each with his stat line from the Highlights' cited stats. */
export function standouts(data: HighlightsData): Standout[] {
  return data.standouts.map((standout) => ({
    ...standout,
    statLine: data.stats
      .filter((stat) => stat.player === standout.player && stat.team === standout.team)
      .map((stat) => `${formatStat(stat.value)} ${lowerFirst(stat.label)}${stat.per ? " per game" : ""}`)
      .join(", "),
  }));
}

export interface SeasonStatRow {
  /** The player, or "49ers" for a team stat. */
  who: string;
  name: string;
  value: string;
}

/** Season Stats' team stats and player stats, in the order the page gives them. */
export function seasonStatRows(data: SeasonStatsData): { team: SeasonStatRow[]; players: SeasonStatRow[] } {
  const row = (stat: CitedStat): SeasonStatRow => ({
    who: stat.player ?? "49ers",
    name: `${stat.label}${stat.per ? " per game" : ""}`,
    value: formatStat(stat.value),
  });
  return {
    team: data.stats.filter((stat) => stat.player === undefined).map(row),
    players: data.stats.filter((stat) => stat.player !== undefined).map(row),
  };
}

/** The newest season's Season Stats. */
export function currentSeasonStats<T extends { data: SeasonStatsData }>(entries: readonly T[]): T | undefined {
  return [...entries].sort((a, b) => b.data.season - a.data.season)[0];
}

function lowerFirst(label: string): string {
  return label.charAt(0).toLowerCase() + label.slice(1);
}
