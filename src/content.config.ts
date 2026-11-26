import { defineCollection } from "astro:content";
import { glob } from "astro/loaders";
import { GAME_WEEK_FILES, gamePreviewSchema, seasonRecapSchema, statBreakdownSchema } from "./content/game-week";
import { newsSummarySchema } from "./content/news-summary";
import { draftCoverageSchema, freeAgencyTrackerSchema, OFFSEASON_FILES } from "./content/offseason";
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


// The Offseason's running documents: one folder per Offseason under content/offseason/.
const freeAgencyTrackers = defineCollection({
  loader: glob({ base: contentPath("offseason"), pattern: `*/${OFFSEASON_FILES["free-agency-tracker"]}` }),
  schema: freeAgencyTrackerSchema,
});

const draftCoverage = defineCollection({
  loader: glob({ base: contentPath("offseason"), pattern: `*/${OFFSEASON_FILES["draft-coverage"]}` }),
  schema: draftCoverageSchema,
});

export const collections = { news, gamePreviews, seasonRecaps, statBreakdowns, freeAgencyTrackers, draftCoverage };
