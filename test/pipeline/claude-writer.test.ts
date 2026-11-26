// The Claude writer's pure parts: turning its structured output into drafts, and telling a
// spend-limit error from a retryable one. Nothing here calls Claude.
import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { publish } from "../../src/pipeline";
import { isSpendLimitError, toDraftEntries, type WriterOutput } from "../../src/pipeline/adapters/real/claude-writer";
import { fakeSources, recordedSnapshot } from "../support/fakes";

const snapshot = recordedSnapshot("daily-news-2026-11-25");
const SHANAHAN_URL = "https://www.49ers.com/news/shanahan-press-conference-wednesday";
const INJURY_URL = "https://www.49ers.com/news/injury-report-wednesday-week-13";

const output: WriterOutput = {
  summaries: [
    {
      category: "Coach's Comments",
      title: "Shanahan wants more on third down",
      body: 'Kyle Shanahan said, "We have to be better on third down."',
      sources: [{ url: SHANAHAN_URL, outlet: "49ers.com" }],
      injuries: [],
      quotes: [{ text: "We have to be better on third down.", speaker: "Kyle Shanahan", source: SHANAHAN_URL }],
    },
    {
      category: "Injury",
      title: "Warner sits out Wednesday",
      body: "Fred Warner did not practice Wednesday.",
      sources: [{ url: INJURY_URL, outlet: "49ers.com" }],
      injuries: [{ player: "Fred Warner", practiceStatus: "DNP", gameStatus: null }],
      quotes: [],
    },
  ],
};

describe("Claude writer output", () => {
  it("becomes News Summary drafts, leaving out empty lists and unset statuses", () => {
    expect(toDraftEntries(output)).toEqual([
      {
        type: "news-summary",
        data: {
          title: "Shanahan wants more on third down",
          category: "Coach's Comments",
          sources: [{ url: SHANAHAN_URL, outlet: "49ers.com" }],
          quotes: [{ text: "We have to be better on third down.", speaker: "Kyle Shanahan", source: SHANAHAN_URL }],
        },
        body: 'Kyle Shanahan said, "We have to be better on third down."',
      },
      {
        type: "news-summary",
        data: {
          title: "Warner sits out Wednesday",
          category: "Injury",
          sources: [{ url: INJURY_URL, outlet: "49ers.com" }],
          injuries: [{ player: "Fred Warner", practiceStatus: "DNP" }],
        },
        body: "Fred Warner did not practice Wednesday.",
      },
    ]);
  });

  it("produces drafts the publish checks accept when they match the sources", async () => {
    const result = await publish({
      job: "daily-news",
      date: "2026-11-25",
      sources: fakeSources(snapshot),
      writer: { write: async () => toDraftEntries(output) },
    });

    expect(result.status).toBe("published");
  });
});

describe("spend-limit errors", () => {
  const headers = new Headers();

  it("recognises the spend-cap 429", () => {
    const error = Anthropic.APIError.generate(
      429,
      { type: "error", error: { type: "rate_limit_error", message: "Spend limit reached.", details: { error_code: "enforced_spend_limit_reached" } } },
      undefined,
      headers,
    );
    expect(isSpendLimitError(error)).toBe(true);
  });

  it("recognises the workspace spend-limit 400", () => {
    const error = Anthropic.APIError.generate(
      400,
      {
        type: "error",
        error: { type: "invalid_request_error", message: "This request would exceed your workspace's spend limit." },
      },
      undefined,
      headers,
    );
    expect(isSpendLimitError(error)).toBe(true);
  });

  it("doesn't mistake an ordinary rate limit or bad request for one", () => {
    const rateLimited = Anthropic.APIError.generate(
      429,
      { type: "error", error: { type: "rate_limit_error", message: "Number of request tokens has exceeded your per-minute rate limit." } },
      undefined,
      headers,
    );
    const badRequest = Anthropic.APIError.generate(
      400,
      { type: "error", error: { type: "invalid_request_error", message: "max_tokens: field required" } },
      undefined,
      headers,
    );
    expect(isSpendLimitError(rateLimited)).toBe(false);
    expect(isSpendLimitError(badRequest)).toBe(false);
    expect(isSpendLimitError(new Error("spend limit"))).toBe(false);
  });
});
