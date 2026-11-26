// Whether Brock Purdy played a game: the DNP determination the Purdy Shrine rests on.
//
// It comes from the schedule against his nflverse lines, never from the writer: a 49ers game
// he has no nflverse player line for is a game he didn't play (DNP). nflverse gives a line to
// every player who recorded a stat, and a quarterback who takes a snap records one. To tell a
// DNP from stats that aren't out yet, the game's 49ers team line must be there. Pure.
import { PURDY } from "../content/purdy-shrine";
import { TEAM } from "./calendar";
import type { NflverseStats } from "./stats";

export function purdyPlayed(stats: NflverseStats | undefined, gameId: string): boolean {
  if (!stats?.teams.some((line) => line.gameId === gameId && line.team === TEAM)) {
    throw new Error(`nflverse has no 49ers stats for ${gameId}, so there's no telling whether ${PURDY.player} played`);
  }
  return stats.players.some((line) => line.gameId === gameId && line.playerId === PURDY.playerId);
}
