// What every Claude writer shares: the rules its voice prompt states the same way.

/** The number grounding check (src/pipeline/checks/numbers.ts), as a writer must follow it. */
export const NUMBERS_RULE = `- numbers: every number you write in prose (the title, body, and every other text field) must be either one of your cited stats, at the value you cite (rounded no further than to a whole number), or a number that appears in a document you list as a source. Years, dates, kickoff times, Week numbers, and the scores and records the brief gives are fine. Never round to a different number ("topped 160" for 164.7), project ("on pace for"), or state a number you can't ground; leave the number out. A single ungrounded number stops the whole run.`;
