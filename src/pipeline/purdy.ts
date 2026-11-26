// Brock Purdy's numbers for the Purdy Shrine: whether he played a game (DNP), and his stat
// tracker. Pure: it reads only the schedule and nflverse lines it is given.
//
// DNP comes from the schedule against his nflverse lines, never from the writer: a 49ers game
// he has no nflverse player line for is a game he didn't play. nflverse gives a line to every
// player who recorded a stat, and a quarterback who takes a snap records one. So that a DNP is
// never just stats that aren't out yet, the game's 49ers team line must be there (this season),
// and he must have lines in every earlier season (the sources fetch only his, for those).
import type { CitedStat, StatScope } from "../content/cited-stat";
import { PURDY, TRACKER_COLUMNS, TRACKER_RATES } from "../content/purdy-shrine";
import { gameWeekSlug, TEAM, type ScheduledGame } from "./calendar";
import { round } from "./checks/nflverse-stats";
import { statValue, type NflverseStats } from "./stats";

/** Whether Purdy played the game. Fails when nflverse doesn't have the game's 49ers stats yet. */
export function purdyPlayed(stats: NflverseStats | undefined, gameId: string): boolean {
  if (!stats?.teams.some((line) => line.gameId === gameId && line.team === TEAM)) {
    throw new Error(`nflverse has no 49ers stats for ${gameId}, so there's no telling whether ${PURDY.player} played`);
  }
  return hasLine(stats, gameId);
}

function hasLine(stats: NflverseStats, gameId: string): boolean {
  return stats.players.some((line) => line.gameId === gameId && line.playerId === PURDY.playerId);
}

/**
 * The tracker's numbers through the game just played (on or before `date`): each season since
 * 2022 with its games, games played, and DNPs; this season's game log; and every stat shown,
 * as cited stats with nflverse's values (rates to one decimal place).
 */
export function purdyStatTracker(game: ScheduledGame, schedule: readonly ScheduledGame[], stats: NflverseStats, date: string) {
  const final = schedule.filter((g) => g.result && g.gameday < date).sort((a, b) => a.kickoff.localeCompare(b.kickoff));
  const seasonNumbers = Array.from({ length: game.season - PURDY.firstSeason + 1 }, (_, i) => PURDY.firstSeason + i);

  const seasons = seasonNumbers.map((season) => {
    const games = final.filter((g) => g.season === season);
    if (games.length === 0) throw new Error(`the schedule has no 49ers games in the ${season} season, which ${PURDY.player}'s stat tracker covers`);
    if (season < game.season && !games.some((g) => hasLine(stats, g.gameId))) {
      throw new Error(`there are no nflverse lines for ${PURDY.player} in the ${season} season, so his stat tracker can't be worked out (it would call every game a DNP)`);
    }
    const played = games.filter((g) => (season === game.season ? purdyPlayed(stats, g.gameId) : hasLine(stats, g.gameId))).length;
    return { season, games: games.length, played, dnp: games.length - played };
  });

  const gameLog = final
    .filter((g) => g.season === game.season)
    .map((g) => ({
      gameId: g.gameId,
      gameWeek: gameWeekSlug(g.season, g.week, g.gameType),
      week: g.week,
      gameType: g.gameType,
      opponent: g.opponent,
      venue: g.neutralSite ? ("neutral" as const) : g.home ? ("home" as const) : ("away" as const),
      result: g.result!,
      played: purdyPlayed(stats, g.gameId),
    }));

  const cite = (scope: StatScope, rates: boolean): CitedStat[] =>
    TRACKER_COLUMNS.filter(([column]) => rates || !TRACKER_RATES.includes(column)).flatMap(([stat, label]) => {
      const found = statValue(stats, { player: PURDY.player, team: TEAM, stat, scope });
      if ("error" in found) return [];
      return [{ player: PURDY.player, team: TEAM, stat, scope, value: TRACKER_RATES.includes(stat) ? round(found.value, 1) : found.value, label }];
    });

  const citedStats = [
    ...seasons.filter((row) => row.played > 0).flatMap((row) => cite({ type: "season", season: row.season }, true)),
    ...cite({ type: "seasons", from: PURDY.firstSeason, to: game.season }, true),
    ...gameLog.filter((g) => g.played).flatMap((g) => cite({ type: "game", gameId: g.gameId }, false)),
  ];
  return { seasons, gameLog, stats: citedStats };
}
