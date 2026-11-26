// How each content type's drafts become entries: the schema that validates them, the fields
// the pipeline owns (the writer can't set or get them wrong), and where the entry is filed.
import type { z } from "astro/zod";
import { GAME_WEEK_FILES, gamePreviewSchema, highlightsSchema, seasonRecapSchema, statBreakdownSchema } from "../content/game-week";
import { newsSummarySchema } from "../content/news-summary";
import { draftCoverageSchema, draftDates, freeAgencyTrackerSchema, OFFSEASON_FILES, offseasonYear } from "../content/offseason";
import { seasonStatsPath, seasonStatsSchema } from "../content/season-stats";
import { predictionRecordPath, predictionRecordSchema, scorePrediction } from "../content/prediction-record";
import { mergeDraftCoverage, mergeFreeAgencyTracker } from "./running-documents";
import { gameJustPlayed, gameWeekSlug, seasonRecord, type ScheduledGame } from "./calendar";
import type { ContentType, Job, SourceSnapshot } from "./types";

interface ContentTypeDefinition {
  schema: z.ZodType;
  /** Fields the pipeline fills in, overriding anything the writer put there. */
  owned(job: Job, snapshot: SourceSnapshot): Record<string, unknown>;
  /** Where the entry goes inside the content folder. */
  path(data: Record<string, unknown>, job: Job): string;
  /** A run writes exactly one of these (a Game Week Page has one Game Preview). */
  single?: boolean;
  /**
   * For a running document: folds the writer's update into the document as it stood (from the
   * snapshot), before the owned fields are filled in. Without it the draft is the whole entry.
   */
  merge?(draft: Record<string, unknown>, snapshot: SourceSnapshot): Record<string, unknown>;
  /**
   * For content the pipeline works out itself, with no writer: the draft it makes from the
   * snapshot, or undefined when there is nothing to write this run.
   */
  derive?(job: Job, snapshot: SourceSnapshot): { data: Record<string, unknown>; body: string } | undefined;
}

export const CONTENT_TYPES: Record<ContentType, ContentTypeDefinition> = {
  "news-summary": {
    schema: newsSummarySchema,
    owned: (job) => ({ date: job.date }),
    path: (data, job) => `news/${job.date}-${slugify(typeof data.title === "string" ? data.title : "untitled")}.md`,
  },
  "game-preview": {
    schema: gamePreviewSchema,
    single: true,
    owned: (job) => ({ date: job.date, ...upcomingGame(job, "a Game Preview") }),
    path: (data) => `game-weeks/${data.gameWeek}/${GAME_WEEK_FILES["game-preview"]}`,
  },
  "stat-breakdown": {
    schema: statBreakdownSchema,
    single: true,
    owned: (job) => ({ date: job.date, ...upcomingGame(job, "a Stat Breakdown") }),
    path: (data) => `game-weeks/${data.gameWeek}/${GAME_WEEK_FILES["stat-breakdown"]}`,
  },
  "season-recap": {
    schema: seasonRecapSchema,
    single: true,
    owned: (job, snapshot) => {
      const calendar = job.calendar;
      if (calendar?.period !== "bye-week") throw new Error("a season recap is written only in a Bye Week");
      const next = calendar.upcoming;
      return {
        date: job.date,
        gameWeek: calendar.gameWeek,
        season: calendar.season,
        week: calendar.week,
        record: seasonRecord(snapshot.schedule ?? [], calendar.season, job.date),
        nextGame: {
          gameWeek: gameWeekSlug(next.season, next.week, next.gameType),
          opponent: next.opponent,
          venue: venue(next),
          kickoff: next.kickoff,
        },
      };
    },
    path: (data) => `game-weeks/${data.gameWeek}/${GAME_WEEK_FILES["season-recap"]}`,
  },
  highlights: {
    schema: highlightsSchema,
    single: true,
    owned: (job) => {
      const game = playedGame(job, "Highlights");
      return {
        date: job.date,
        gameWeek: gameWeekSlug(game.season, game.week, game.gameType),
        gameId: game.gameId,
        season: game.season,
        week: game.week,
        gameType: game.gameType,
        opponent: game.opponent,
        venue: venue(game),
        kickoff: game.kickoff,
        result: game.result,
      };
    },
    path: (data) => `game-weeks/${data.gameWeek}/${GAME_WEEK_FILES.highlights}`,
  },
  "season-stats": {
    schema: seasonStatsSchema,
    single: true,
    owned: (job, snapshot) => {
      const game = playedGame(job, "Season Stats");
      return {
        title: `${game.season} Season Stats`,
        season: game.season,
        updated: job.date,
        throughGame: {
          gameId: game.gameId,
          gameWeek: gameWeekSlug(game.season, game.week, game.gameType),
          week: game.week,
          gameType: game.gameType,
          opponent: game.opponent,
          venue: venue(game),
          result: game.result,
        },
        record: seasonRecord(snapshot.schedule ?? [], game.season, job.date),
      };
    },
    path: (data) => seasonStatsPath(data.season as number),
  },
  "prediction-record": {
    schema: predictionRecordSchema,
    // Scores the game's Game Preview against the final score. A re-run for the same game replaces
    // its earlier score rather than adding a second. No Game Preview for the game, nothing to write.
    derive: (job, snapshot) => {
      const game = playedGame(job, "Prediction Records");
      const preview = snapshot.gamePreview;
      if (preview?.gameId !== game.gameId) return undefined;
      const scored = {
        gameId: game.gameId,
        gameWeek: gameWeekSlug(game.season, game.week, game.gameType),
        week: game.week,
        gameType: game.gameType,
        opponent: game.opponent,
        venue: venue(game),
        result: game.result,
        predicted: preview.prediction,
        ...scorePrediction(preview.prediction, game.result, game.opponent),
      };
      const current = snapshot.current?.["prediction-record"];
      const earlier = current?.data.season === game.season ? current.data.games.filter((g) => g.gameId !== game.gameId) : [];
      // Playoff weeks continue the numbering, so the week orders the season's games.
      const games = [...earlier, scored].sort((a, b) => a.week - b.week);
      return { data: { games }, body: current?.body ?? "" };
    },
    owned: (job) => {
      const game = playedGame(job, "Prediction Records");
      return { title: `${game.season} Prediction Record`, season: game.season, updated: job.date };
    },
    path: (data) => predictionRecordPath(data.season as number),
  },
  "free-agency-tracker": {
    schema: freeAgencyTrackerSchema,
    single: true,
    merge: (draft, snapshot) => mergeFreeAgencyTracker(draft, snapshot.current?.["free-agency-tracker"]?.data),
    owned: (job) => offseasonOwned(job, "Free Agency Tracker"),
    path: (data) => `offseason/${data.offseason}/${OFFSEASON_FILES["free-agency-tracker"]}`,
  },
  "draft-coverage": {
    schema: draftCoverageSchema,
    single: true,
    merge: (draft, snapshot) => mergeDraftCoverage(draft, snapshot.current?.["draft-coverage"]?.data),
    owned: (job) => ({ ...offseasonOwned(job, "Draft Coverage"), draft: draftDates(offseasonYear(job.date)) }),
    path: (data) => `offseason/${data.offseason}/${OFFSEASON_FILES["draft-coverage"]}`,
  },
};

/** A Game Week's upcoming game, from the schedule: the fields its Game Week Page parts share. */
function upcomingGame(job: Job, what: string) {
  const calendar = job.calendar;
  if (calendar?.period !== "game-week") throw new Error(`${what} is written only in a Game Week`);
  const game = calendar.upcoming;
  return {
    gameWeek: calendar.gameWeek,
    gameId: game.gameId,
    season: game.season,
    week: game.week,
    gameType: game.gameType,
    opponent: game.opponent,
    venue: venue(game),
    kickoff: game.kickoff,
  };
}

/** The game played the day before the job's date, with its final score: what post-game content is about. */
export function playedGame(job: Job, what: string): ScheduledGame & { result: NonNullable<ScheduledGame["result"]> } {
  const game = job.calendar && gameJustPlayed(job.calendar, job.date);
  if (!game) throw new Error(`${what} are written only the day after a game`);
  if (!game.result) throw new Error(`the schedule has no final score for ${game.gameId} yet`);
  return { ...game, result: game.result };
}

/** Fields the pipeline owns on both Offseason running documents. */
function offseasonOwned(job: Job, name: string) {
  if (job.calendar?.period !== "offseason") throw new Error(`the ${name} is written only in the Offseason`);
  const year = offseasonYear(job.date);
  return { title: `${year} ${name}`, offseason: year, updated: job.date };
}

function venue(game: ScheduledGame): "home" | "away" | "neutral" {
  return game.neutralSite ? "neutral" : game.home ? "home" : "away";
}

export function slugify(title: string): string {
  return title
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}
