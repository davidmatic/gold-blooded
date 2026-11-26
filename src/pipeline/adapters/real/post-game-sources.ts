// The real sources for the post-game job. It runs every day, so it first fetches only the
// 49ers' nflverse schedule, which says whether a game was played the day before. If none was
// (or the game has no final score yet, which the pipeline reports), that is all it collects.
//
// The day after a game it adds, for the game just played:
// - the day's news snapshot (Preferred Sources and the injury report, as the daily news job
//   collects them), which carries the game recaps and postgame press conferences;
// - the season's nflverse player and team stats. They must already include the game: if they
//   don't yet, the run fails rather than write Highlights without the game's numbers;
// - the official 49ers and NFL YouTube videos posted since kickoff (best effort).
//
// Later post-game content adds what it needs here (the game's Game Preview, for the Prediction
// Record; Purdy's career lines, for his stat tracker).
import { gameJustPlayed, resolveCalendar, TEAM } from "../../calendar";
import type { Job, SourceAdapter, SourceSnapshot } from "../../types";
import { fetchNflverseStats } from "./nflverse-stats";
import { fetchSchedule } from "./schedule";
import { fetchWithBotUserAgent, realSources, type FetchPage } from "./sources";
import { officialVideosSince } from "./youtube";

export interface PostGameSourcesOptions {
  fetchPage?: FetchPage;
  /** Collects the day's news and injury report. Defaults to the real news sources. */
  news?: SourceAdapter;
  log?: (message: string) => void;
}

export function postGameSources(options: PostGameSourcesOptions = {}): SourceAdapter {
  const fetchPage = options.fetchPage ?? fetchWithBotUserAgent;
  const log = options.log ?? ((message: string) => console.log(message));
  const news = options.news ?? realSources({ fetchPage, log });

  return {
    async collect(job: Job): Promise<SourceSnapshot> {
      const schedule = await fetchSchedule(fetchPage);
      const game = gameJustPlayed(resolveCalendar(job.date, schedule), job.date);
      if (!game?.result) return { date: job.date, documents: [], schedule };

      const [snapshot, { stats, skipped: statsSkipped }, clips] = await Promise.all([
        news.collect({ type: "daily-news", date: job.date }),
        fetchNflverseStats(fetchPage, game.season),
        officialVideosSince(fetchPage, game.kickoff, log),
      ]);
      if (!stats.teams.some((line) => line.gameId === game.gameId && line.team === TEAM)) {
        throw new Error(
          `nflverse has no stats for ${game.gameId} yet. Run the post-game job again for ${job.date} once they are out ` +
            "(Actions → Post-game → Run workflow, with that date).",
        );
      }
      const skipped = [...(snapshot.skipped ?? []), ...(statsSkipped ? [statsSkipped] : []), ...clips.skipped];
      return { ...snapshot, date: job.date, schedule, stats, videos: clips.videos, ...(skipped.length > 0 && { skipped }) };
    },
    linkResolves: (url) => news.linkResolves(url),
  };
}
