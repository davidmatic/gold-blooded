// nflverse stats in the source snapshot, and looking up a cited stat in them.
//
// The snapshot holds nflverse's week-level lines (one per player per game, one per team per
// game). Season totals, last-N totals, per-game averages, and the derived rates are all worked
// out here from those lines, so a cited stat means one thing everywhere: in the writer's brief,
// in the stat publish check, and on the site. Pure: it reads only the lines it is given.
import { DERIVED_STATS, type CitedStat, type StatScope } from "../content/cited-stat";

/** One team's nflverse line for one game (stats_team_week). */
export interface TeamStatLine {
  season: number;
  week: number;
  seasonType: "REG" | "POST";
  gameId: string;
  team: string;
  opponent: string;
  /** Every numeric column nflverse gives for the line, by column name. Empty (NA) cells are left out. */
  stats: Record<string, number>;
}

/** One player's nflverse line for one game (stats_player_week). A player who recorded no stats has no line. */
export interface PlayerStatLine extends TeamStatLine {
  /** The nflverse (gsis) player id, e.g. `00-0037834`. */
  playerId: string;
  /** The player's name as nflverse displays it, e.g. `Brock Purdy`. */
  player: string;
  position: string;
}

/** The nflverse stats a source snapshot carries. */
export interface NflverseStats {
  players: PlayerStatLine[];
  teams: TeamStatLine[];
}

/** What identifies a stat: everything in a cited stat except the value and how it is shown. */
export type StatRef = Omit<CitedStat, "value" | "label">;

/** nflverse columns that are rates or maxima, so they can't be added up over several games. */
const RATES = new Set(["passing_cpoe", "pacr", "racr", "target_share", "air_yards_share", "wopr", "fg_pct", "pat_pct", "fg_long", "pt_long"]);

const DERIVED: Record<(typeof DERIVED_STATS)[number], [numerator: string, denominator: string, scale: number]> = {
  completion_pct: ["completions", "attempts", 100],
  yards_per_attempt: ["passing_yards", "attempts", 1],
  yards_per_carry: ["rushing_yards", "carries", 1],
  yards_per_reception: ["receiving_yards", "receptions", 1],
};

/** The stat's value in nflverse, or why nflverse can't give one. */
export function statValue(stats: NflverseStats, ref: StatRef): { value: number } | { error: string } {
  const lines = scoped(ref.player === undefined ? stats.teams : stats.players.filter((line) => sameName(line.player, ref.player!)), ref);
  if (lines.length === 0) return { error: `nflverse has no line for ${subject(ref)} in ${inScope(ref.scope)}` };

  const derived = DERIVED[ref.stat as keyof typeof DERIVED];
  if (derived) {
    if (ref.per) return { error: `${ref.stat} is a rate, so it can't be given per game` };
    const [numerator, denominator, scale] = derived;
    const bottom = total(lines, denominator);
    if (!bottom) return { error: `${ref.stat} needs ${denominator}, and nflverse has none for ${subject(ref)} in ${inScope(ref.scope)}` };
    return { value: (total(lines, numerator) / bottom) * scale };
  }

  if (!lines.some((line) => Object.hasOwn(line.stats, ref.stat))) {
    const known = [...stats.teams, ...stats.players].some((line) => Object.hasOwn(line.stats, ref.stat));
    return { error: known ? `nflverse gives no ${ref.stat} for ${subject(ref)} in ${inScope(ref.scope)}` : `nflverse has no stat ${ref.stat}` };
  }
  if (RATES.has(ref.stat) && (lines.length > 1 || ref.per || ref.scope.type !== "game")) {
    return { error: `${ref.stat} is a rate, so cite it for one game` };
  }
  const sum = total(lines, ref.stat);
  return { value: ref.per ? sum / lines.length : sum };
}

/** "Brock Purdy (SF) passing_yards per game, last 3 games of 2026". */
export function describeStat(ref: StatRef): string {
  return `${subject(ref)} ${ref.stat}${ref.per ? " per game" : ""}, ${scopeText(ref.scope)}`;
}

/** "2026 season", "2026 regular season", "last 3 games of 2026", "game 2026_05_SF_SEA". */
export function scopeText(scope: StatScope): string {
  if (scope.type === "game") return `game ${scope.gameId}`;
  if (scope.type === "last-games") return `last ${scope.games} games of ${scope.season}`;
  if (scope.type === "seasons") return `${scope.from} to ${scope.to} seasons`;
  return `${scope.season} ${scope.seasonType === "REG" ? "regular season" : scope.seasonType === "POST" ? "postseason" : "season"}`;
}

/** The scope after "in": "the 2026 season", "game 2026_05_SF_SEA". */
function inScope(scope: StatScope): string {
  return scope.type === "game" ? scopeText(scope) : `the ${scopeText(scope)}`;
}

function subject(ref: StatRef): string {
  return ref.player === undefined ? ref.team : `${ref.player} (${ref.team})`;
}

/** The lines in the stat's scope, for its team: one per game. */
function scoped<T extends TeamStatLine>(lines: readonly T[], ref: StatRef): T[] {
  const scope = ref.scope;
  const mine = lines.filter((line) => line.team === ref.team);
  if (scope.type === "game") return mine.filter((line) => line.gameId === scope.gameId);
  if (scope.type === "seasons") return mine.filter((line) => line.season >= scope.from && line.season <= scope.to);
  const season = mine.filter((line) => line.season === scope.season && (scope.type !== "season" || !scope.seasonType || line.seasonType === scope.seasonType));
  if (scope.type === "season") return season;
  return [...season].sort((a, b) => a.week - b.week).slice(-scope.games);
}

function total(lines: readonly TeamStatLine[], column: string): number {
  return lines.reduce((sum, line) => sum + (Object.hasOwn(line.stats, column) ? line.stats[column]! : 0), 0);
}

/** "Deebo Samuel Sr." is "Deebo Samuel", and case and periods don't matter. */
function sameName(a: string, b: string): boolean {
  return nameKey(a) === nameKey(b);
}

function nameKey(name: string): string {
  return name
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[.'’]/g, "")
    .replace(/\b(jr|sr|ii|iii|iv|v)\b/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}
