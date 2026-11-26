// Types at the publish pipeline's seam (Seam 1 in spec #1).
import type { GamePreviewData, HighlightsData, SeasonRecapData, StatBreakdownData } from "../content/game-week";
import type { SeasonStatsData } from "../content/season-stats";
import type { GameStatus, NewsSummaryData, PracticeStatus } from "../content/news-summary";
import type { DraftCoverageData, FreeAgencyTrackerData } from "../content/offseason";
import type { CalendarPosition, ScheduledGame } from "./calendar";
import type { NflverseStats } from "./stats";

export type { GameStatus, PracticeStatus };
export type { CalendarPeriod, CalendarPosition, GameType, ScheduledGame } from "./calendar";
export type { NflverseStats, PlayerStatLine, TeamStatLine } from "./stats";

/** The scheduled jobs. Each has its own workflow. */
export type JobType = "daily-news" | "post-game" | "thursday-preview" | "film-room" | "offseason";

/** A job to run: its type and the date it runs for (YYYY-MM-DD, team-local). */
export interface Job {
  type: JobType;
  date: string;
  /**
   * What the writer should produce this run. Set by the pipeline once it has the source
   * snapshot, so it is absent when the sources collect.
   */
  contentTypes?: ContentType[];
  /** Where the date falls on the calendar, for jobs that depend on it. Set with contentTypes. */
  calendar?: CalendarPosition;
}

/** One piece of raw source material: an article, report, or transcript. */
export interface SourceDocument {
  url: string;
  outlet: string;
  title: string;
  publishedAt: string;
  /** The document's full text. The quote check looks for quotes here, word for word. */
  text: string;
  /** Set when the document is a podcast episode's transcript: who to credit its opinions to. */
  podcast?: PodcastCredit;
}

export interface PodcastCredit {
  show: string;
  hosts: string[];
}

/**
 * One player's line on the official NFL injury report, as of the snapshot's date.
 * A status is absent when the report doesn't give one yet (game status is set only on
 * the final report of the week).
 */
export interface InjuryReportEntry {
  player: string;
  practiceStatus?: PracticeStatus;
  gameStatus?: GameStatus;
}

/**
 * Everything a job's sources returned, gathered once per run.
 * Later tickets add nflverse stats and transcripts.
 */
export interface SourceSnapshot {
  date: string;
  documents: SourceDocument[];
  /** The official NFL injury report. Absent when the sources couldn't get one. */
  injuryReport?: InjuryReportEntry[];
  /** The 49ers' nflverse schedule (all seasons it covers). Jobs that use the calendar need it. */
  schedule?: ScheduledGame[];
  /**
   * nflverse player and team stats, one line per player or team per game. The stat publish check
   * compares every cited stat with these. Jobs that cite stats need them.
   */
  stats?: NflverseStats;
  /**
   * The newest videos on the official 49ers and NFL YouTube channels, from their RSS feeds. The
   * only videos content may embed: the official-clips publish check holds every clip to these.
   */
  videos?: OfficialVideo[];
  /** Best-effort outlets the sources couldn't collect this run (blocked, down), and why. */
  skipped?: SkippedSource[];
  /**
   * The Offseason's running documents as they stand before this run, read from the content
   * store. Absent (or missing one) before the Offseason's first update.
   */
  current?: Partial<{ [T in RunningContentType]: { data: ContentTypes[T]; body: string } }>;
}

/** Content types that are one running document per Offseason, updated run after run. */
export type RunningContentType = "free-agency-tracker" | "draft-coverage";

/** One video from an official channel's YouTube RSS feed. */
export interface OfficialVideo {
  videoId: string;
  title: string;
  /** The channel's name as its feed gives it, e.g. "San Francisco 49ers". */
  channel: string;
  url: string;
  publishedAt: string;
  description: string;
}

export interface SkippedSource {
  outlet: string;
  reason: string;
}

/** Gathers source material. The only route the pipeline has to the network. */
export interface SourceAdapter {
  collect(job: Job): Promise<SourceSnapshot>;
  /** Whether a cited link loads. Used by the source-link publish check. */
  linkResolves(url: string): Promise<boolean>;
}

/** Turns a snapshot into draft content entries (the Claude writer, or a fake). */
export interface ContentWriter {
  write(job: Job, snapshot: SourceSnapshot): Promise<DraftEntry[]>;
}

/** Content types the pipeline can publish, by their frontmatter. */
export interface ContentTypes {
  "news-summary": NewsSummaryData;
  "game-preview": GamePreviewData;
  "season-recap": SeasonRecapData;
  "stat-breakdown": StatBreakdownData;
  "free-agency-tracker": FreeAgencyTrackerData;
  "draft-coverage": DraftCoverageData;
  highlights: HighlightsData;
  "season-stats": SeasonStatsData;
}
export type ContentType = keyof ContentTypes;

/**
 * What the writer hands back. The pipeline fills in what it owns (such as the date)
 * and validates the rest against the content type's schema, so `data` is untrusted.
 */
export interface DraftEntry {
  type: ContentType;
  data: Record<string, unknown>;
  body: string;
}

/** A content entry ready to be written to the content store. */
export type ContentEntry = {
  [T in ContentType]: {
    type: T;
    /** Path inside the content folder, e.g. `news/2026-11-25-warner-sits-out.md`. */
    path: string;
    data: ContentTypes[T];
    body: string;
  };
}[ContentType];

export interface CheckFailure {
  /** The publish check that failed, e.g. `source-links`. */
  check: string;
  /** The draft it failed on, when it is about one draft. */
  entry?: string;
  reason: string;
}

export type PublishResult =
  | { status: "published"; entries: ContentEntry[] }
  | { status: "rejected"; failures: CheckFailure[] };

export interface PublishRequest {
  job: JobType;
  date: string;
  sources: SourceAdapter;
  writer: ContentWriter;
}
