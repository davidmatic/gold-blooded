// How the Stat Breakdown's cited stats read on its Game Week Page: team stats side by side
// (49ers and the opponent), player stats one per row.
import type { CitedStat, StatScope } from "../content/cited-stat";
import type { StatBreakdownData } from "../content/game-week";

export interface TeamRow {
  name: string;
  sf?: number;
  opponent?: number;
}

export interface PlayerRow {
  player: string;
  team: string;
  name: string;
  value: number;
}

/** The team stats, one row per stat and scope, with the 49ers' and the opponent's values. */
export function teamRows(data: StatBreakdownData): TeamRow[] {
  const rows = new Map<string, TeamRow>();
  for (const stat of data.stats) {
    if (stat.player !== undefined) continue;
    const name = statName(stat);
    const row = rows.get(name) ?? rows.set(name, { name }).get(name)!;
    row[stat.team === "SF" ? "sf" : "opponent"] = stat.value;
  }
  return [...rows.values()];
}

/** The player stats, in the order the breakdown gives them. */
export function playerRows(data: StatBreakdownData): PlayerRow[] {
  return data.stats.flatMap((stat) => (stat.player === undefined ? [] : [{ player: stat.player, team: stat.team, name: statName(stat), value: stat.value }]));
}

/** "Rushing yards per game, 2026 season". */
export function statName(stat: CitedStat): string {
  return `${stat.label}${stat.per ? " per game" : ""}, ${scopeName(stat.scope)}`;
}

/** "2026 season", "2026 regular season", "last 3 games", "Week 5 (SF at SEA)". */
export function scopeName(scope: StatScope): string {
  if (scope.type === "last-games") return `last ${scope.games} games`;
  if (scope.type === "season") return `${scope.season} ${scope.seasonType === "REG" ? "regular season" : scope.seasonType === "POST" ? "postseason" : "season"}`;
  if (scope.type === "seasons") return `${scope.from} to ${scope.to} seasons`;
  const [, week, away, home] = scope.gameId.split("_");
  return `Week ${Number(week)} (${away} at ${home})`;
}

const numberFormat = new Intl.NumberFormat("en-US", { maximumFractionDigits: 3 });

/** "2,624", "138.6". */
export function formatStat(value: number | undefined): string {
  return value === undefined ? "–" : numberFormat.format(value);
}
