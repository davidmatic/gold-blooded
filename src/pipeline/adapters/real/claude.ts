// The one Claude request every real writer makes: a voice prompt (cached) and a brief, with
// structured output matching a Zod schema. Transient errors are retried twice; reaching the
// workspace spend limit fails at once and is never retried. The pipeline still validates
// whatever comes back and runs every publish check, so nothing Claude writes is trusted.
//
// The key comes from ANTHROPIC_API_KEY (a repository secret in the workflows).
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { z } from "zod";

/** The default model: the Game Preview, Stat Breakdown, post-game and Offseason writers. */
export const MODEL = "claude-opus-5-5";
/** Half Opus's price, for the high-volume daily jobs (daily news, Film Room). */
export const ROUTINE_MODEL = "claude-sonnet-5-5";

const MAX_ATTEMPTS = 3;

/**
 * Whether an API error means the spend limit was reached: a 429 with error_code
 * `enforced_spend_limit_reached`, or a 400 invalid_request_error about the workspace spend
 * limit. Retrying either only burns time, so the run fails at once.
 */
export function isSpendLimitError(error: unknown): boolean {
  if (!(error instanceof Anthropic.APIError)) return false;
  const body = (error.error ?? {}) as { error?: { type?: string; message?: string; details?: { error_code?: string } } };
  if (body.error?.details?.error_code === "enforced_spend_limit_reached") return true;
  const mentionsSpendLimit = /spend(ing)? limit/i.test(body.error?.message ?? error.message);
  return (error.status === 400 || error.status === 429) && mentionsSpendLimit;
}

export class SpendLimitReachedError extends Error {
  constructor(cause: unknown) {
    super(
      "The Anthropic API spend limit was reached, so the writer stopped without retrying. " +
        "Raise the workspace spend limit in the Claude Console, or wait for the next month.",
      { cause },
    );
    this.name = "SpendLimitReachedError";
  }
}

/** Transient failures worth another try: connection errors, timeouts, 408/409/429/5xx. */
function isRetryable(error: unknown): boolean {
  if (isSpendLimitError(error)) return false;
  if (error instanceof Anthropic.APIConnectionError) return true;
  return error instanceof Anthropic.APIError && (error.status === 408 || error.status === 409 || error.status === 429 || (error.status ?? 0) >= 500);
}

export interface ClaudeOptions {
  client?: Anthropic;
  /** Defaults to MODEL (Opus). */
  model?: typeof MODEL | typeof ROUTINE_MODEL;
  log?: (message: string) => void;
  /** Waits between retries. Tests pass one that doesn't wait. */
  sleep?: (ms: number) => Promise<void>;
}

/** Asks Claude, in the given voice, for a reply to the brief that matches the schema. */
export type AskClaude = <T extends z.ZodType>(voice: string, schema: T, brief: string) => Promise<z.infer<T>>;

export function claudeAsker(options: ClaudeOptions = {}): AskClaude {
  // The SDK's own retries would retry a spend-limit 429, so they are off and retries happen here.
  const client = options.client ?? new Anthropic({ maxRetries: 0 });
  const log = options.log ?? ((message: string) => console.log(message));
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));

  return async (voice, schema, brief) => {
    for (let attempt = 1; ; attempt++) {
      try {
        const response = await client.beta.messages.parse({
          model: options.model ?? MODEL,
          max_tokens: 16000,
          betas: ["server-side-fallback-2026-07-01"],
          fallbacks: "default",
          output_config: { effort: "medium", format: betaZodOutputFormat(schema) },
          system: [{ type: "text", text: voice, cache_control: { type: "ephemeral" } }],
          messages: [{ role: "user", content: brief }],
        });
        const usage = response.usage;
        log(
          `Claude (${response.model}): stop_reason ${response.stop_reason}; input ${usage.input_tokens} ` +
            `(cache read ${usage.cache_read_input_tokens ?? 0}), output ${usage.output_tokens} tokens`,
        );
        if (response.stop_reason === "refusal") throw new Error(`Claude declined to write (${response.stop_details?.category ?? "no category"})`);
        if (response.stop_reason === "max_tokens") throw new Error("Claude's reply was cut off at max_tokens");
        if (!response.parsed_output) throw new Error(`Claude's reply didn't match the schema (${response.stop_reason})`);
        return response.parsed_output;
      } catch (error) {
        if (isSpendLimitError(error)) throw new SpendLimitReachedError(error);
        if (attempt >= MAX_ATTEMPTS || !isRetryable(error)) throw error;
        const delay = 2 ** attempt * 5_000;
        log(`Claude request failed (${error instanceof Error ? error.message : error}); retrying in ${delay / 1000}s`);
        await sleep(delay);
      }
    }
  };
}
