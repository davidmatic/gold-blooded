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
// - from the content folder, the game's Game Preview (absent when none was published) and the
//   season's Prediction Record as it stands, which the pipeline scores the preview into. A
//   Prediction Record that fails its schema (a broken hand edit) fails the run, rather than being
//   overwritten by one that would lose its games.
//
// For the Purdy Shrine (#10):
// - Brock Purdy's nflverse lines from every earlier season since 2022 (each season's player
//   file, keeping only his lines), for his stat tracker. A season's file that won't load fails
//   the run, rather than leave his career short;
// - from the content folder, the Reasons We Love Brock list as it stands, which the new reason
//   is added to (a list that fails its schema fails the run, like the Prediction Record).
import type { z } from "astro/zod";
import { GAME_WEEK_FILES, gamePreviewSchema } from "../../../content/game-week";
import { predictionRecordPath, predictionRecordSchema } from "../../../content/prediction-record";
import { PURDY, PURDY_SHRINE_FILES, reasonsWeLoveBrockSchema } from "../../../content/purdy-shrine";
import { gameJustPlayed, gameWeekSlug, resolveCalendar, TEAM, type ScheduledGame } from "../../calendar";
import { readEntry } from "../../content-store";
import type { Job, SourceAdapter, SourceSnapshot } from "../../types";
import { fetchNflverseStats, fetchPlayerSeason } from "./nflverse-stats";
import { fetchSchedule } from "./schedule";
import { fetchWithBotUserAgent, realSources, type FetchPage } from "./sources";
import { officialVideosSince } from "./youtube";

export interface PostGameSourcesOptions {
  /** The content folder the game's Game Preview and the Prediction Record live in. */
  contentDir?: string;
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

      const [snapshot, { stats, skipped: statsSkipped }, clips, predictions, career, reasons] = await Promise.all([
        news.collect({ type: "daily-news", date: job.date }),
        fetchNflverseStats(fetchPage, game.season),
        officialVideosSince(fetchPage, game.kickoff, log),
        options.contentDir ? predictionInputs(options.contentDir, game) : {},
        purdyEarlierSeasons(fetchPage, game.season),
        options.contentDir ? readValid(options.contentDir, PURDY_SHRINE_FILES["reasons-we-love-brock"], reasonsWeLoveBrockSchema, "the new reason can't be added") : undefined,
      ]);
      if (!stats.teams.some((line) => line.gameId === game.gameId && line.team === TEAM)) {
        throw new Error(
          `nflverse has no stats for ${game.gameId} yet. Run the post-game job again for ${job.date} once they are out ` +
            "(Actions → Post-game → Run workflow, with that date).",
        );
      }
      const skipped = [...(snapshot.skipped ?? []), ...(statsSkipped ? [statsSkipped] : []), ...clips.skipped];
      const current = { ...predictions.current, ...(reasons && { "reasons-we-love-brock": reasons }) };
      return {
        ...snapshot,
        date: job.date,
        schedule,
        stats: { ...stats, players: [...career, ...stats.players] },
        purdyCareer: true,
        videos: clips.videos,
        ...predictions,
        ...(options.contentDir && { current }),
        ...(skipped.length > 0 && { skipped }),
      };
    },
    linkResolves: (url) => news.linkResolves(url),
  };
}

/** Purdy's nflverse lines from each season since his first, before this one. */
async function purdyEarlierSeasons(fetchPage: FetchPage, season: number) {
  const seasons = Array.from({ length: Math.max(season - PURDY.firstSeason, 0) }, (_, i) => PURDY.firstSeason + i);
  return (await Promise.all(seasons.map((s) => fetchPlayerSeason(fetchPage, s, PURDY.playerId)))).flat();
}

/** The game's Game Preview and the season's Prediction Record, from the content folder. */
async function predictionInputs(contentDir: string, game: ScheduledGame): Promise<Pick<SourceSnapshot, "gamePreview" | "current">> {
  const preview = await readValid(contentDir, `game-weeks/${gameWeekSlug(game.season, game.week, game.gameType)}/${GAME_WEEK_FILES["game-preview"]}`, gamePreviewSchema);
  const record = await readValid(contentDir, predictionRecordPath(game.season), predictionRecordSchema);
  return { ...(preview && { gamePreview: preview.data }), current: record ? { "prediction-record": record } : {} };
}

async function readValid<T>(contentDir: string, file: string, schema: z.ZodType<T>, consequence = "the Prediction Record can't be scored"): Promise<{ data: T; body: string } | undefined> {
  const entry = await readEntry(contentDir, file);
  if (!entry) return undefined;
  const parsed = schema.safeParse(entry.data);
  if (!parsed.success) {
    const reason = parsed.error.issues.map((issue) => `${issue.path.join(".") || "frontmatter"}: ${issue.message}`).join("; ");
    throw new Error(`${file} doesn't match its schema, so ${consequence} (fix the file): ${reason}`);
  }
  return { data: parsed.data, body: entry.body };
}
