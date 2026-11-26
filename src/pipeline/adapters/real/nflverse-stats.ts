// nflverse player and team stats for one season, for the stat publish check and the writers.
//
// nflverse publishes week-level stats as release assets, updated nightly: one line per player
// per game (stats_player_week_<season>.csv) and one per team per game (stats_team_week_<season>.csv),
// regular season and postseason. A player with no recorded stats in a game has no line for it.
// Every numeric column is kept, by its nflverse name; empty (NA) and text cells are left out.
// Before a season's first games the files don't exist yet (HTTP 404).
import type { NflverseStats, PlayerStatLine, TeamStatLine } from "../../stats";
import type { SkippedSource } from "../../types";
import { parseCsv } from "./schedule";
import type { FetchPage } from "./sources";

const RELEASES = "https://github.com/nflverse/nflverse-data/releases/download";

export function statsUrls(season: number) {
  return {
    players: `${RELEASES}/stats_player/stats_player_week_${season}.csv`,
    teams: `${RELEASES}/stats_team/stats_team_week_${season}.csv`,
  };
}

const TEAM_KEYS = ["season", "week", "season_type", "game_id", "team", "opponent_team"];
const PLAYER_KEYS = [...TEAM_KEYS, "player_id", "player_display_name", "position"];
/** Identifying columns that aren't stats, even where they are numeric. */
const NOT_STATS = new Set([...PLAYER_KEYS, "player_name", "position_group", "headshot_url"]);

/** The team-week lines in a stats_team_week CSV. */
export function parseTeamStats(csv: string): TeamStatLine[] {
  return rows(csv, TEAM_KEYS, "stats_team_week").map(teamLine);
}

/** The player-week lines in a stats_player_week CSV. */
export function parsePlayerStats(csv: string): PlayerStatLine[] {
  return rows(csv, PLAYER_KEYS, "stats_player_week").map((row) => ({
    playerId: row.player_id!,
    player: row.player_display_name!,
    position: row.position!,
    ...teamLine(row),
  }));
}

/**
 * The season's stats. Before the season's first stats are out (both files 404), the stats are
 * empty and the miss is reported as skipped; any other failure fails the run.
 */
export async function fetchNflverseStats(fetchPage: FetchPage, season: number): Promise<{ stats: NflverseStats; skipped?: SkippedSource }> {
  const urls = statsUrls(season);
  const [players, teams] = await Promise.all([fetchCsv(fetchPage, urls.players, "player"), fetchCsv(fetchPage, urls.teams, "team")]);
  if (players === undefined || teams === undefined) {
    return { stats: { players: [], teams: [] }, skipped: { outlet: "nflverse stats", reason: `no ${season} stats yet (HTTP 404)` } };
  }
  return { stats: { players: parsePlayerStats(players), teams: parseTeamStats(teams) } };
}

/**
 * One player's lines from an earlier season's stats (the whole file is fetched; only his lines
 * are kept). The season is over, so its file must be there: a miss fails the run.
 */
export async function fetchPlayerSeason(fetchPage: FetchPage, season: number, playerId: string): Promise<PlayerStatLine[]> {
  const url = statsUrls(season).players;
  const csv = await fetchCsv(fetchPage, url, `${season} player`);
  if (csv === undefined) throw new Error(`could not fetch the nflverse ${season} player stats (${url}): HTTP 404`);
  return parsePlayerStats(csv).filter((line) => line.playerId === playerId);
}

async function fetchCsv(fetchPage: FetchPage, url: string, kind: string): Promise<string | undefined> {
  const page = await fetchPage(url).catch((error: unknown) => {
    throw new Error(`could not fetch the nflverse ${kind} stats (${url}): ${error instanceof Error ? error.message : error}`);
  });
  if (page.status === 404) return undefined;
  if (page.status < 200 || page.status > 299) throw new Error(`could not fetch the nflverse ${kind} stats (${url}): HTTP ${page.status}`);
  return page.body;
}

function rows(csv: string, required: string[], file: string): Record<string, string>[] {
  const [header, ...cells] = parseCsv(csv);
  const missing = required.filter((column) => !header?.includes(column));
  if (!header || missing.length > 0) throw new Error(`not the nflverse ${file} stats (missing ${missing.join(", ")})`);
  return cells.map((row) => Object.fromEntries(header.map((name, i) => [name, row[i] ?? ""])));
}

function teamLine(row: Record<string, string>): TeamStatLine {
  const stats: Record<string, number> = {};
  for (const [column, cell] of Object.entries(row)) {
    if (NOT_STATS.has(column) || cell.trim() === "") continue;
    const value = Number(cell);
    if (Number.isFinite(value)) stats[column] = value;
  }
  return {
    season: Number(row.season),
    week: Number(row.week),
    seasonType: row.season_type === "POST" ? "POST" : "REG",
    gameId: row.game_id!,
    team: row.team!,
    opponent: row.opponent_team!,
    stats,
  };
}
