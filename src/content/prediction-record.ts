// The Prediction Record (GLOSSARY.md): how each Game Preview's prediction (winner and score)
// compared with the actual result. One running document per season,
// `content/prediction-record/<season>.md`, which the post-game job updates the day after every
// game whose Game Preview was published. The pipeline scores each game itself, with no writer:
//
// - correctWinner: whether the predicted winner won (a tie is a miss for either pick);
// - pointsOff: how far the predicted score was from the final, both teams' scores together
//   (predicted 24-17, final 35-10: 11 + 7 = 18 points off).
//
// Games with no Game Preview are never added, so they don't count either way.
import { z } from "astro/zod";
import { GAME_TYPES } from "../pipeline/calendar";
import { isoDate } from "./news-summary";

const score = z.object({ sf: z.number().int().nonnegative(), opponent: z.number().int().nonnegative() });
type Score = z.infer<typeof score>;

export const scoredPrediction = z.object({
  gameId: z.string().min(1),
  gameWeek: z.string().min(1),
  week: z.number().int(),
  gameType: z.enum(GAME_TYPES),
  opponent: z.string().min(1),
  venue: z.enum(["home", "away", "neutral"]),
  /** The final score. */
  result: score,
  /** The Game Preview's prediction: the winner (SF or the opponent) and the score. */
  predicted: z.object({ winner: z.string().min(1), score }),
  correctWinner: z.boolean(),
  pointsOff: z.number().int().nonnegative(),
});

export type ScoredPrediction = z.infer<typeof scoredPrediction>;

export const predictionRecordSchema = z
  .object({
    title: z.string().min(1),
    season: z.number().int(),
    /** When the post-game job last scored a game. */
    updated: isoDate,
    /** Every scored game, in the order played. */
    games: z.array(scoredPrediction),
  })
  .superRefine((record, ctx) => {
    record.games.forEach((game, i) => {
      const scored = scorePrediction(game.predicted, game.result, game.opponent);
      if (scored.correctWinner !== game.correctWinner) ctx.addIssue({ code: "custom", path: ["games", i, "correctWinner"], message: `should be ${scored.correctWinner}` });
      if (scored.pointsOff !== game.pointsOff) ctx.addIssue({ code: "custom", path: ["games", i, "pointsOff"], message: `should be ${scored.pointsOff}` });
    });
  });

export type PredictionRecordData = z.infer<typeof predictionRecordSchema>;

/** Scores one prediction against the final score. */
export function scorePrediction(predicted: { winner: string; score: Score }, result: Score, opponent: string): { correctWinner: boolean; pointsOff: number } {
  const winner = result.sf > result.opponent ? "SF" : result.opponent > result.sf ? opponent : undefined;
  return {
    correctWinner: predicted.winner === winner,
    pointsOff: Math.abs(predicted.score.sf - result.sf) + Math.abs(predicted.score.opponent - result.opponent),
  };
}

/** The season's tally: games scored, correct winners, and the average points off (one decimal place). */
export function predictionTally(record: Pick<PredictionRecordData, "games">): { scored: number; correctWinners: number; averagePointsOff: number | undefined } {
  const scored = record.games.length;
  const total = record.games.reduce((sum, game) => sum + game.pointsOff, 0);
  return {
    scored,
    correctWinners: record.games.filter((game) => game.correctWinner).length,
    averagePointsOff: scored === 0 ? undefined : Math.round((total / scored) * 10) / 10,
  };
}

/** Where a season's Prediction Record lives in the content folder. */
export function predictionRecordPath(season: number): string {
  return `prediction-record/${season}.md`;
}
