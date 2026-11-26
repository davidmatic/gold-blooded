// Game Week Pages and the homepage's Game Preview: which preview is current, how a Game Week
// is named, and how kickoff and the prediction read.
import type { GamePreviewData, SeasonRecapData, StatBreakdownData } from "../content/game-week";

interface HasData<T> {
  id: string;
  data: T;
}

/** The homepage's current Game Preview: the one for the latest game. */
export function currentPreview<T extends HasData<GamePreviewData>>(previews: readonly T[]): T | undefined {
  return [...previews].sort((a, b) => b.data.kickoff.localeCompare(a.data.kickoff))[0];
}

export interface GameWeekPage<P, R, B = never> {
  slug: string;
  preview?: P;
  recap?: R;
  breakdown?: B;
}

/** One page per Game Week that has any content, newest first. */
export function gameWeekPages<
  P extends HasData<GamePreviewData>,
  R extends HasData<SeasonRecapData>,
  B extends HasData<StatBreakdownData> = never,
>(previews: readonly P[], recaps: readonly R[], breakdowns: readonly B[] = []): GameWeekPage<P, R, B>[] {
  const pages = new Map<string, GameWeekPage<P, R, B>>();
  const page = (slug: string) => pages.get(slug) ?? pages.set(slug, { slug }).get(slug)!;
  for (const preview of previews) page(preview.data.gameWeek).preview = preview;
  for (const recap of recaps) page(recap.data.gameWeek).recap = recap;
  for (const breakdown of breakdowns) page(breakdown.data.gameWeek).breakdown = breakdown;
  return [...pages.values()].sort((a, b) => b.slug.localeCompare(a.slug));
}

/**
 * The Archive: past Game Week Pages, newest first. A Game Week is past once its game has
 * kicked off, or once a newer Game Week Page exists (which also covers Bye Weeks, which have
 * no game). The current or upcoming week stays out.
 */
export function pastGameWeekPages<P extends HasData<GamePreviewData>, R extends HasData<SeasonRecapData>>(
  pages: readonly GameWeekPage<P, R>[],
  now: Date,
): GameWeekPage<P, R>[] {
  // Season, then week: slugs don't sort in calendar order once the playoffs start.
  const order = (page: GameWeekPage<P, R>) => {
    const data = page.preview?.data ?? page.recap?.data;
    return data ? data.season * 100 + data.week : 0;
  };
  const newestFirst = [...pages].sort((a, b) => order(b) - order(a));
  return newestFirst.filter((page, i) => i > 0 || (page.preview !== undefined && new Date(page.preview.data.kickoff) <= now));
}

const ROUNDS: Record<string, string> = { WC: "Wild Card", DIV: "Divisional Round", CON: "Conference Championship", SB: "Super Bowl" };

/** "2026 Week 12", "2025 Wild Card". */
export function gameWeekName(data: { season: number; week: number; gameType?: string }): string {
  const round = data.gameType && ROUNDS[data.gameType];
  return round ? `${data.season} ${round}` : `${data.season} Week ${data.week}`;
}

/** "vs SEA", "at PHI", or "vs MIN (neutral site)". */
export function matchup(data: { opponent: string; venue: "home" | "away" | "neutral" }): string {
  if (data.venue === "away") return `at ${data.opponent}`;
  return data.venue === "neutral" ? `vs ${data.opponent} (neutral site)` : `vs ${data.opponent}`;
}

/** "49ers 27, SEA 20", winner first. */
export function predictionLine(data: GamePreviewData): string {
  const { winner, score } = data.prediction;
  const sf = `49ers ${score.sf}`;
  const opponent = `${data.opponent} ${score.opponent}`;
  return winner === "SF" ? `${sf}, ${opponent}` : `${opponent}, ${sf}`;
}

const kickoffFormat = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Los_Angeles",
  weekday: "short",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

/** Kickoff in the team's time zone: "Sun, Nov 29, 1:25 PM PT". */
export function formatKickoff(iso: string): string {
  return `${kickoffFormat.format(new Date(iso)).replace(/\s/g, " ")} PT`;
}

/** "6-1", or "6-1-1" with a tie. */
export function formatRecord(record: { wins: number; losses: number; ties: number }): string {
  return [record.wins, record.losses, ...(record.ties > 0 ? [record.ties] : [])].join("-");
}
