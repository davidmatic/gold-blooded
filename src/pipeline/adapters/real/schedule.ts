// The 49ers' schedule from nflverse (games.csv), for calendar resolution.
//
// games.csv lists every NFL game since 1999: regular season and playoffs, but no preseason.
// Scores are empty until a game is final. Kickoff times are US Eastern.
import { GAME_TYPES, TEAM, type GameType, type ScheduledGame } from "../../calendar";

export const SCHEDULE_URL = "https://github.com/nflverse/nflverse-data/releases/download/schedules/games.csv";

const REQUIRED_COLUMNS = ["game_id", "season", "game_type", "week", "gameday", "gametime", "away_team", "away_score", "home_team", "home_score", "location"];

/** The 49ers' games in nflverse's games.csv, in kickoff order. */
export function parseSchedule(csv: string): ScheduledGame[] {
  const [header, ...rows] = parseCsv(csv);
  const missing = REQUIRED_COLUMNS.filter((column) => !header?.includes(column));
  if (!header || missing.length > 0) throw new Error(`not the nflverse games.csv schedule (missing ${missing.join(", ")})`);
  const column = Object.fromEntries(header.map((name, i) => [name, i]));

  return rows
    .map((cells) => Object.fromEntries(REQUIRED_COLUMNS.map((name) => [name, cells[column[name]!] ?? ""])))
    .filter((row) => (row.home_team === TEAM || row.away_team === TEAM) && GAME_TYPES.includes(row.game_type as GameType))
    .map((row): ScheduledGame => {
      const home = row.home_team === TEAM;
      const [sf, opponent] = home ? [row.home_score, row.away_score] : [row.away_score, row.home_score];
      return {
        gameId: row.game_id!,
        season: Number(row.season),
        gameType: row.game_type as GameType,
        week: Number(row.week),
        gameday: row.gameday!,
        kickoff: easternToUtc(row.gameday!, row.gametime!).toISOString(),
        opponent: (home ? row.away_team : row.home_team)!,
        home,
        neutralSite: row.location === "Neutral",
        ...(sf !== "" && opponent !== "" && { result: { sf: Number(sf), opponent: Number(opponent) } }),
      };
    })
    .sort((a, b) => a.kickoff.localeCompare(b.kickoff));
}

/** Rows of a CSV file. Handles quoted fields (with commas and doubled quotes inside). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i]!;
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"') quoted = true;
    else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += char;
  }
  if (field || row.length > 0) rows.push([...row, field]);
  return rows.filter((cells) => cells.some((cell) => cell !== ""));
}

const eastern = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  hourCycle: "h23",
  year: "numeric",
  month: "numeric",
  day: "numeric",
  hour: "numeric",
  minute: "numeric",
});

/** The UTC instant of a US Eastern wall-clock date (YYYY-MM-DD) and time (HH:MM). */
function easternToUtc(day: string, time: string): Date {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  const [hour, minute] = (time || "00:00").split(":").map(Number) as [number, number];
  const wall = Date.UTC(y, m - 1, d, hour, minute);
  const offset = (instant: number) => {
    const parts = Object.fromEntries(eastern.formatToParts(new Date(instant)).map((part) => [part.type, Number(part.value)]));
    return Date.UTC(parts.year!, parts.month! - 1, parts.day!, parts.hour!, parts.minute!) - Math.floor(instant / 60_000) * 60_000;
  };
  const guess = wall - offset(wall);
  return new Date(wall - offset(guess));
}
