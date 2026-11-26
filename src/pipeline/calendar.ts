// Calendar resolution: where a date falls in the 49ers' season (GLOSSARY.md, Calendar).
//
// Every job that depends on the calendar uses resolveCalendar(). Given a team-local date and
// the 49ers' schedule from nflverse, it places the date in one of three periods:
//
// - a Game Week: from the day after one 49ers game through the day of the next. It names the
//   upcoming game and, unless it is the season's first, the previous one. Each playoff game is
//   its own Game Week. The first Game Week of a season starts six days before kickoff.
// - a Bye Week: when the schedule skips a week (the 49ers have no game in it). The bye runs
//   from the day after the previous game until a week before the next one; the last seven
//   days before the next game are that game's Game Week.
// - the Offseason: every other date. The nflverse schedule has no preseason games, so the
//   preseason is Offseason too, as is any stretch after the season's last scheduled game.
//
// Pure: it reads only the date and the schedule it is given.

/** The 49ers' abbreviation in nflverse. */
export const TEAM = "SF";

/** nflverse game types: the regular season, then the playoff rounds. */
export const GAME_TYPES = ["REG", "WC", "DIV", "CON", "SB"] as const;
export type GameType = (typeof GAME_TYPES)[number];

/** One 49ers game on the nflverse schedule. */
export interface ScheduledGame {
  /** nflverse game id, e.g. `2026_12_SEA_SF`. */
  gameId: string;
  /** The season, labelled by its start year (January playoff games belong to the year before). */
  season: number;
  gameType: GameType;
  /** NFL week number. Playoff weeks continue the numbering (19 is the Wild Card round). */
  week: number;
  /** The game's date (YYYY-MM-DD), as nflverse gives it (US Eastern). */
  gameday: string;
  /** Kickoff as an ISO instant (UTC). */
  kickoff: string;
  opponent: string;
  /** Whether the 49ers are the home team. A neutral-site game still has a nominal home team. */
  home: boolean;
  neutralSite: boolean;
  /** The final score, once the game is over. */
  result?: { sf: number; opponent: number };
}

export type CalendarPosition =
  | {
      period: "game-week";
      /** The Game Week Page's slug, e.g. `2026-week-12` or `2025-wild-card`. */
      gameWeek: string;
      season: number;
      week: number;
      upcoming: ScheduledGame;
      /** The previous game of the same season; absent in a season's first Game Week. */
      previous?: ScheduledGame;
    }
  | {
      period: "bye-week";
      gameWeek: string;
      season: number;
      /** The NFL week the 49ers have off. */
      week: number;
      previous: ScheduledGame;
      upcoming: ScheduledGame;
    }
  | {
      period: "offseason";
      /** The last game played before the date, if the schedule has one. */
      previous?: ScheduledGame;
      /** The next season's first game, once it is scheduled. */
      next?: ScheduledGame;
    };

export type CalendarPeriod = CalendarPosition["period"];

/** Places a team-local date (YYYY-MM-DD) on the calendar of the given 49ers schedule. */
export function resolveCalendar(date: string, schedule: readonly ScheduledGame[]): CalendarPosition {
  const games = [...schedule].sort((a, b) => a.kickoff.localeCompare(b.kickoff));
  const upcoming = games.find((game) => game.gameday >= date);
  const previous = games.findLast((game) => game.gameday < date);

  if (upcoming && previous && upcoming.season === previous.season) {
    const skipped = upcoming.week - previous.week - 1;
    if (skipped > 0 && date <= addDays(upcoming.gameday, -7)) {
      const week = Math.min(previous.week + 1 + Math.floor(daysBetween(previous.gameday, date) / 7), upcoming.week - 1);
      return {
        period: "bye-week",
        gameWeek: gameWeekSlug(upcoming.season, week, roundOfWeek(week, upcoming)),
        season: upcoming.season,
        week,
        previous,
        upcoming,
      };
    }
    return gameWeek(upcoming, previous);
  }
  if (upcoming && date >= addDays(upcoming.gameday, -6)) return gameWeek(upcoming);
  return { period: "offseason", ...(previous && { previous }), ...(upcoming && { next: upcoming }) };
}

/**
 * How many days after a game the post-game job still covers it. A run that fails (nflverse
 * hasn't posted the game's stats yet) is caught up by the next day's runs, up to this many days on.
 */
export const POST_GAME_DAYS = 3;

/**
 * The game the post-game job covers on a date: the most recent 49ers game before it, if it was
 * played within the last POST_GAME_DAYS days. In any period, so the season's last game counts
 * though the days after it are the Offseason. (nflverse's gameday is US Eastern; a late Pacific
 * kickoff still falls on it.) Whether its post-game content is already written is up to the caller.
 */
export function gameToCover(calendar: CalendarPosition, date: string): ScheduledGame | undefined {
  const game = calendar.previous;
  if (!game) return undefined;
  const days = daysBetween(game.gameday, date);
  return days >= 1 && days <= POST_GAME_DAYS ? game : undefined;
}

/** A Game Week Page's slug: `2026-week-08` in the regular season, `2025-wild-card` in the playoffs. */
export function gameWeekSlug(season: number, week: number, gameType: GameType): string {
  if (gameType !== "REG") return `${season}-${ROUND_SLUGS[gameType]}`;
  return `${season}-week-${String(week).padStart(2, "0")}`;
}

const ROUND_SLUGS: Record<Exclude<GameType, "REG">, string> = {
  WC: "wild-card",
  DIV: "divisional",
  CON: "conference-championship",
  SB: "super-bowl",
};

/** The 49ers' wins, losses, and ties in a season, from games final before the date. */
export function seasonRecord(schedule: readonly ScheduledGame[], season: number, before: string) {
  const record = { wins: 0, losses: 0, ties: 0 };
  for (const game of schedule) {
    if (game.season !== season || game.gameday >= before || !game.result) continue;
    const margin = game.result.sf - game.result.opponent;
    if (margin > 0) record.wins++;
    else if (margin < 0) record.losses++;
    else record.ties++;
  }
  return record;
}

function gameWeek(upcoming: ScheduledGame, previous?: ScheduledGame): CalendarPosition {
  return {
    period: "game-week",
    gameWeek: gameWeekSlug(upcoming.season, upcoming.week, upcoming.gameType),
    season: upcoming.season,
    week: upcoming.week,
    upcoming,
    ...(previous && { previous }),
  };
}

/** The game type of a week the 49ers skip: a playoff bye takes the round it falls in. */
function roundOfWeek(week: number, upcoming: ScheduledGame): GameType {
  if (upcoming.gameType === "REG") return "REG";
  const round = GAME_TYPES.indexOf(upcoming.gameType) - (upcoming.week - week);
  return GAME_TYPES[Math.max(round, 0)]!;
}

function addDays(day: string, days: number): string {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

function daysBetween(from: string, to: string): number {
  return (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000;
}
