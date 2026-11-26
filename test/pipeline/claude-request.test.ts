// The shared Claude request every real writer makes: retries on transient errors, a hard stop at
// the spend limit, and the reply checks. Driven through a fake client; nothing here calls Claude.
import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { claudeAsker, SpendLimitReachedError } from "../../src/pipeline/adapters/real/claude";

const schema = z.object({ title: z.string() });
const reply = (overrides: object = {}) => ({
  model: "claude-opus-5-5",
  stop_reason: "end_turn",
  usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0 },
  parsed_output: { title: "Hello" },
  ...overrides,
});

/** A client whose parse() answers with each of `answers` in turn (an Error is thrown). */
function fakeClient(answers: unknown[]) {
  const requests: Record<string, unknown>[] = [];
  const client = {
    beta: {
      messages: {
        parse: async (request: Record<string, unknown>) => {
          requests.push(request);
          const answer = answers[requests.length - 1];
          if (answer instanceof Error) throw answer;
          return answer;
        },
      },
    },
  } as unknown as Anthropic;
  return { client, requests };
}

const quiet = { log: () => {}, sleep: async () => {} };
const apiError = (status: number, body: object) => Anthropic.APIError.generate(status, { type: "error", error: body }, undefined, new Headers());

describe("Claude request", () => {
  it("sends the voice as a cached system prompt and the brief as the user turn, and returns the parsed reply", async () => {
    const { client, requests } = fakeClient([reply()]);
    const ask = claudeAsker({ client, ...quiet });

    expect(await ask("The voice.", schema, "The brief.")).toEqual({ title: "Hello" });
    expect(requests[0]).toMatchObject({
      model: "claude-opus-5-5",
      system: [{ type: "text", text: "The voice.", cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: "The brief." }],
    });
  });

  it("retries a transient error, up to three attempts in all", async () => {
    const overloaded = apiError(529, { type: "overloaded_error", message: "Overloaded" });
    const once = fakeClient([overloaded, reply()]);
    expect(await claudeAsker({ client: once.client, ...quiet })("v", schema, "b")).toEqual({ title: "Hello" });
    expect(once.requests).toHaveLength(2);

    const always = fakeClient([overloaded, overloaded, overloaded, reply()]);
    await expect(claudeAsker({ client: always.client, ...quiet })("v", schema, "b")).rejects.toThrow("Overloaded");
    expect(always.requests).toHaveLength(3);
  });

  it("stops at once, without retrying, when the spend limit is reached", async () => {
    const capped = apiError(429, { type: "rate_limit_error", message: "Spend limit reached.", details: { error_code: "enforced_spend_limit_reached" } });
    const { client, requests } = fakeClient([capped, reply()]);

    await expect(claudeAsker({ client, ...quiet })("v", schema, "b")).rejects.toBeInstanceOf(SpendLimitReachedError);
    expect(requests).toHaveLength(1);
  });

  it("fails on a refusal, a reply cut off at max_tokens, or one that doesn't match the schema", async () => {
    const ask = (answer: object) => claudeAsker({ client: fakeClient([answer]).client, ...quiet })("v", schema, "b");

    await expect(ask(reply({ stop_reason: "refusal", stop_details: { category: "cyber" }, parsed_output: null }))).rejects.toThrow("Claude declined to write (cyber)");
    await expect(ask(reply({ stop_reason: "max_tokens", parsed_output: null }))).rejects.toThrow("cut off at max_tokens");
    await expect(ask(reply({ parsed_output: null }))).rejects.toThrow("didn't match the schema");
  });
});
