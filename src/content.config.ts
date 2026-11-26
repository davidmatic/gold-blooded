import { defineCollection } from "astro:content";
import { glob } from "astro/loaders";
import { GAME_WEEK_FILES, gamePreviewSchema, highlightsSchema, seasonRecapSchema, statBreakdownSchema } from "./content/game-week";
import { newsSummarySchema } from "./content/news-summary";
import { draftCoverageSchema, freeAgencyTrackerSchema, OFFSEASON_FILES } from "./content/offseason";
import { seasonStatsSchema } from "./content/season-stats";
import { predictionRecordSchema } from "./content/prediction-record";
import { loveLetterSchema, originStorySchema, purdyStatTrackerSchema, reasonsWeLoveBrockSchema } from "./content/purdy-shrine";
import { contentPath } from "./site/content-dir";

const news = defineCollection({
  loader: glob({ base: contentPath("news"), pattern: "**/*.md" }),
  schema: newsSummarySchema,
});

// Game Week Pages: one folder per Game Week under content/game-weeks/, one file per part.
const gamePreviews = defineCollection({
  loader: glob({ base: contentPath("game-weeks"), pattern: `*/${GAME_WEEK_FILES["game-preview"]}` }),
  schema: gamePreviewSchema,
});

const seasonRecaps = defineCollection({
  loader: glob({ base: contentPath("game-weeks"), pattern: `*/${GAME_WEEK_FILES["season-recap"]}` }),
  schema: seasonRecapSchema,
});

const statBreakdowns = defineCollection({
  loader: glob({ base: contentPath("game-weeks"), pattern: `*/${GAME_WEEK_FILES["stat-breakdown"]}` }),
  schema: statBreakdownSchema,
});

const highlights = defineCollection({
  loader: glob({ base: contentPath("game-weeks"), pattern: `*/${GAME_WEEK_FILES.highlights}` }),
  schema: highlightsSchema,
});

// Season Stats: one standing document per season, content/season-stats/<season>.md.
const seasonStats = defineCollection({
  loader: glob({ base: contentPath("season-stats"), pattern: "*.md" }),
  schema: seasonStatsSchema,
});

// The Offseason's running documents: one folder per Offseason under content/offseason/.
const freeAgencyTrackers = defineCollection({
  loader: glob({ base: contentPath("offseason"), pattern: `*/${OFFSEASON_FILES["free-agency-tracker"]}` }),
  schema: freeAgencyTrackerSchema,
});

const draftCoverage = defineCollection({
  loader: glob({ base: contentPath("offseason"), pattern: `*/${OFFSEASON_FILES["draft-coverage"]}` }),
  schema: draftCoverageSchema,
});

// The Prediction Record: one running document per season, content/prediction-record/<season>.md.
const predictionRecords = defineCollection({
  loader: glob({ base: contentPath("prediction-record"), pattern: "*.md" }),
  schema: predictionRecordSchema,
});

// The Purdy Shrine: content/purdy-shrine/, a Love Letter per game under love-letters/, and one
// file each for the reasons list, the stat tracker, and the origin story.
const loveLetters = defineCollection({
  loader: glob({ base: contentPath("purdy-shrine", "love-letters"), pattern: "*.md" }),
  schema: loveLetterSchema,
});

const reasonsWeLoveBrock = defineCollection({
  loader: glob({ base: contentPath("purdy-shrine"), pattern: "reasons.md" }),
  schema: reasonsWeLoveBrockSchema,
});

const purdyStatTracker = defineCollection({
  loader: glob({ base: contentPath("purdy-shrine"), pattern: "stat-tracker.md" }),
  schema: purdyStatTrackerSchema,
});

const originStory = defineCollection({
  loader: glob({ base: contentPath("purdy-shrine"), pattern: "origin-story.md" }),
  schema: originStorySchema,
});

export const collections = {
  news,
  gamePreviews,
  seasonRecaps,
  statBreakdowns,
  highlights,
  seasonStats,
  predictionRecords,
  freeAgencyTrackers,
  draftCoverage,
  loveLetters,
  reasonsWeLoveBrock,
  purdyStatTracker,
  originStory,
};
