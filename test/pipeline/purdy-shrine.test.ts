// The Purdy Shrine's share of the post-game job, through the publish pipeline (Seam 1): the
// weekly Love Letter (adoring, or "we miss you" when Purdy didn't play), the Reasons We Love
// Brock running list, and his stat tracker. The recorded snapshot carries the 49ers' real 2025
// and 2026 schedule and their 2026 nflverse lines through Week 11 (35-10 over Minnesota,
// 2026-11-22), in which Purdy played every game.
import { describe, expect, it } from "vitest";
import { publish, type ContentWriter, type DraftEntry, type Job, type SourceSnapshot } from "../../src/pipeline";
import { fakeSources, recordedSnapshot, withPurdyCareer } from "../support/fakes";

const GAME = "2026_11_MIN_SF";
const DATE = "2026-11-23";
const snapshot = recordedSnapshot("thursday-preview-2026-11-26");

/** The same snapshot, but Purdy has no nflverse line from the Minnesota game: he didn't play. */
const purdySatOut: SourceSnapshot = {
  ...snapshot,
  stats: { ...snapshot.stats!, players: snapshot.stats!.players.filter((line) => !(line.player === "Brock Purdy" && line.gameId === GAME)) },
};

const highlights: DraftEntry = {
  type: "highlights",
  data: {
    title: "Kittle carves up Minnesota",
    standouts: [{ player: "George Kittle", team: "SF", writeUp: "Two scores, both in the red zone." }],
    stats: [{ player: "George Kittle", team: "SF", stat: "receiving_tds", scope: { type: "game", gameId: GAME }, value: 2, label: "Receiving TDs" }],
  },
  body: "A clinical night in Mexico City.",
};

const seasonStats: DraftEntry = {
  type: "season-stats",
  data: { stats: [{ team: "SF", stat: "rushing_yards", scope: { type: "season", season: 2026 }, value: 1386, label: "Rushing yards" }] },
  body: "Nine wins in ten.",
};

const loveLetter: DraftEntry = {
  type: "love-letter",
  data: {
    title: "Dear Brock, about Mexico City",
    stats: [{ player: "Brock Purdy", team: "SF", stat: "passing_tds", scope: { type: "game", gameId: GAME }, value: 3, label: "Passing TDs" }],
  },
  body: "Three touchdowns, and every one of them landed right in our hearts.",
};

const missYouLetter: DraftEntry = {
  type: "love-letter",
  data: { title: "Dear Brock, we missed you" },
  body: "The house felt so quiet without you, Brock. Come back to us soon.",
};

const reason: DraftEntry = { type: "reasons-we-love-brock", data: { reason: "He never stops smiling, even in a downpour." }, body: "" };

/** A writer that returns the drafts of the types the job asks for, and remembers the job. */
function recordingWriter(drafts: DraftEntry[]): ContentWriter & { jobs: Job[] } {
  const jobs: Job[] = [];
  return {
    jobs,
    write: async (job) => {
      jobs.push(job);
      return drafts.filter((draft) => job.contentTypes?.includes(draft.type));
    },
  };
}

function runPostGame(drafts: DraftEntry[], source: SourceSnapshot = snapshot) {
  return publish({ job: "post-game", date: DATE, sources: fakeSources(source), writer: recordingWriter(drafts) });
}

async function published(drafts: DraftEntry[], source: SourceSnapshot = snapshot) {
  const result = await runPostGame(drafts, source);
  if (result.status !== "published") throw new Error(`expected a published run: ${JSON.stringify(result.failures, null, 2)}`);
  return result.entries;
}

describe("post-game job: the Love Letter", () => {
  it("writes an adoring Love Letter about the game just played, when Purdy played", async () => {
    const entries = await published([highlights, seasonStats, loveLetter, reason]);

    expect(entries.find((entry) => entry.type === "love-letter")).toEqual({
      type: "love-letter",
      path: "purdy-shrine/love-letters/2026-week-11.md",
      data: {
        ...loveLetter.data,
        date: DATE,
        variant: "adoring",
        gameWeek: "2026-week-11",
        gameId: GAME,
        season: 2026,
        week: 11,
        gameType: "REG",
        opponent: "MIN",
        venue: "neutral",
        result: { sf: 35, opponent: 10 },
      },
      body: loveLetter.body,
    });
  });

  it("switches to the \"we miss you\" variant when Purdy didn't play, whatever the writer says", async () => {
    const claimsAdoring = { ...missYouLetter, data: { ...missYouLetter.data, variant: "adoring" } };
    const entries = await published([highlights, seasonStats, claimsAdoring, reason], purdySatOut);
    const letter = entries.find((entry) => entry.type === "love-letter");

    expect(letter?.data).toMatchObject({ title: "Dear Brock, we missed you", variant: "we-miss-you", gameWeek: "2026-week-11" });
    expect(letter?.body).toBe(missYouLetter.body);
  });

  it("keeps the adoring variant when Purdy played, even if the writer asks for the other one", async () => {
    const claimsMissYou = { ...loveLetter, data: { ...loveLetter.data, variant: "we-miss-you" } };
    const entries = await published([highlights, seasonStats, claimsMissYou, reason]);

    expect(entries.find((entry) => entry.type === "love-letter")?.data).toMatchObject({ variant: "adoring" });
  });

  it("stays adoring after a loss", async () => {
    const lost: SourceSnapshot = { ...snapshot, schedule: snapshot.schedule!.map((game) => (game.gameId === GAME ? { ...game, result: { sf: 10, opponent: 35 } } : game)) };
    const entries = await published([highlights, seasonStats, loveLetter, reason], lost);

    expect(entries.find((entry) => entry.type === "love-letter")?.data).toMatchObject({ variant: "adoring", result: { sf: 10, opponent: 35 } });
  });

  it("rejects a Love Letter stat that doesn't match nflverse", async () => {
    const wrong = { ...loveLetter, data: { ...loveLetter.data, stats: [{ ...(loveLetter.data.stats as object[])[0], value: 4 }] } };
    const result = await runPostGame([highlights, seasonStats, wrong, reason]);

    expect(result).toEqual({
      status: "rejected",
      failures: [{ check: "nflverse-stats", entry: "purdy-shrine/love-letters/2026-week-11.md", reason: "Brock Purdy (SF) passing_tds, game 2026_11_MIN_SF: draft says 4, nflverse says 3" }],
    });
  });

  it("rejects a \"we miss you\" letter that cites his stats from a game he didn't play", async () => {
    const result = await runPostGame([highlights, seasonStats, { ...loveLetter, data: { ...loveLetter.data } }, reason], purdySatOut);

    expect(result.status === "rejected" && result.failures.map((failure) => failure.check)).toEqual(["nflverse-stats"]);
  });

  it("fails the run when nflverse doesn't have the game's 49ers stats, rather than guess at DNP", async () => {
    const noGame: SourceSnapshot = { ...snapshot, stats: { players: [], teams: snapshot.stats!.teams.filter((line) => line.gameId !== GAME) } };

    await expect(runPostGame([highlights, seasonStats, loveLetter, reason], noGame)).rejects.toThrow(/no 49ers stats for 2026_11_MIN_SF/);
  });
});

describe("post-game job: injuries in the Love Letter", () => {
  const injuryReport = [{ player: "Brock Purdy", practiceStatus: "DNP" as const, gameStatus: "Out" as const }];
  const hurt: SourceSnapshot = { ...purdySatOut, injuryReport };
  const mentions = (injuries?: object[]): DraftEntry => ({
    ...missYouLetter,
    data: { ...missYouLetter.data, ...(injuries && { injuries }) },
    body: "The official report listed you as out with that toe injury, and we counted every minute.",
  });

  it("publishes an injury status that matches the official report", async () => {
    const entries = await published([highlights, seasonStats, mentions([{ player: "Brock Purdy", gameStatus: "Out" }]), reason], hurt);

    expect(entries.find((entry) => entry.type === "love-letter")?.data).toMatchObject({ variant: "we-miss-you", injuries: [{ player: "Brock Purdy", gameStatus: "Out" }] });
  });

  it("rejects an injury status the official report doesn't give", async () => {
    const result = await runPostGame([highlights, seasonStats, mentions([{ player: "Brock Purdy", gameStatus: "Questionable" }]), reason], hurt);

    expect(result).toEqual({
      status: "rejected",
      failures: [{ check: "injury-status", entry: "purdy-shrine/love-letters/2026-week-11.md", reason: "Brock Purdy: draft says game status Questionable, official injury report says Out" }],
    });
  });

  it("rejects a letter that talks about an injury without stating the status it goes by", async () => {
    const result = await runPostGame([highlights, seasonStats, mentions(), reason], hurt);

    expect(result).toEqual({
      status: "rejected",
      failures: [
        {
          check: "injury-mentions",
          entry: "purdy-shrine/love-letters/2026-week-11.md",
          reason: "the Love Letter mentions an injury (\"injury\") but states no injury status from the official report in injuries",
        },
      ],
    });
  });

  it("rejects an injury mention when Purdy isn't on the official report", async () => {
    const result = await runPostGame([highlights, seasonStats, mentions([{ player: "Brock Purdy", gameStatus: "Out" }]), reason], purdySatOut);

    expect(result.status === "rejected" && result.failures).toEqual([
      { check: "injury-status", entry: "purdy-shrine/love-letters/2026-week-11.md", reason: "Brock Purdy: not on the official injury report" },
    ]);
  });
});

describe("post-game job: Reasons We Love Brock", () => {
  const current = {
    title: "Reasons We Love Brock",
    updated: "2026-11-16",
    reasons: [
      { reason: "He was the last pick of his draft and plays like the first.", added: "2026-11-16" },
      { reason: "He thanks his offensive line every single time.", added: "2026-11-16", gameWeek: "2026-week-10" },
    ],
  };
  const withList: SourceSnapshot = { ...snapshot, current: { "reasons-we-love-brock": { data: current, body: "" } } };
  const reasonsOf = (entries: Awaited<ReturnType<typeof published>>) => entries.find((entry) => entry.type === "reasons-we-love-brock");

  it("adds the game's new reason to the end of the running list, dated and tied to the game", async () => {
    const entries = await published([highlights, seasonStats, loveLetter, reason], withList);

    expect(reasonsOf(entries)).toEqual({
      type: "reasons-we-love-brock",
      path: "purdy-shrine/reasons.md",
      data: {
        title: "Reasons We Love Brock",
        updated: DATE,
        reasons: [...current.reasons, { reason: "He never stops smiling, even in a downpour.", added: DATE, gameWeek: "2026-week-11" }],
      },
      body: "",
    });
  });

  it("starts the list with the first reason when there isn't one yet", async () => {
    const entries = await published([highlights, seasonStats, loveLetter, reason]);

    expect(reasonsOf(entries)?.data).toMatchObject({ reasons: [{ reason: "He never stops smiling, even in a downpour.", added: DATE, gameWeek: "2026-week-11" }] });
  });

  it("keeps the list's hand-written introduction", async () => {
    const entries = await published([highlights, seasonStats, loveLetter, reason], { ...withList, current: { "reasons-we-love-brock": { data: current, body: "Where do we even start?\n" } } });

    expect(reasonsOf(entries)?.body).toBe("Where do we even start?\n");
  });

  it("rejects a reason the list already has", async () => {
    const again = { ...reason, data: { reason: "he thanks his offensive line every single time" } };
    const result = await runPostGame([highlights, seasonStats, loveLetter, again], withList);

    expect(result.status === "rejected" && result.failures).toEqual([
      { check: "schema", entry: "purdy-shrine/reasons.md", reason: "reasons.2.reason: the list already has this reason" },
    ]);
  });

  it("rejects a reason that states a number, since a reason has no cited stats to check it by", async () => {
    const numbers = { ...reason, data: { reason: "He threw for 255 yards on a Sunday night." } };
    const result = await runPostGame([highlights, seasonStats, loveLetter, numbers], withList);

    expect(result.status === "rejected" && result.failures).toEqual([
      { check: "schema", entry: "purdy-shrine/reasons.md", reason: "reasons.2.reason: a reason states no numbers (stats go in the stat tracker and the Love Letter)" },
    ]);
  });
});

describe("post-game job: the Purdy stat tracker", () => {
  // Earlier seasons from PURDY_EARLIER_GAMES: one game each in 2022 to 2024, and the 2025 opener.
  const withCareer = withPurdyCareer;
  const trackerOf = (entries: Awaited<ReturnType<typeof published>>) => entries.find((entry) => entry.type === "purdy-stat-tracker");
  const stat = (tracker: ReturnType<typeof trackerOf>, name: string, scope: object) =>
    tracker?.type === "purdy-stat-tracker" ? tracker.data.stats.find((s) => s.stat === name && JSON.stringify(s.scope) === JSON.stringify(scope))?.value : undefined;

  it("works out his season and career numbers from nflverse, since 2022, without the writer", async () => {
    const writer = recordingWriter([highlights, seasonStats, loveLetter, reason]);
    const result = await publish({ job: "post-game", date: DATE, sources: fakeSources(withCareer(snapshot)), writer });
    const tracker = result.status === "published" ? trackerOf(result.entries) : undefined;

    expect(writer.jobs[0]?.contentTypes).not.toContain("purdy-stat-tracker");
    expect(tracker?.path).toBe("purdy-shrine/stat-tracker.md");
    expect(tracker?.data).toMatchObject({
      title: "Brock Purdy Stat Tracker",
      updated: DATE,
      season: 2026,
      throughGame: { gameId: GAME, gameWeek: "2026-week-11" },
      seasons: [
        { season: 2022, games: 1, played: 1, dnp: 0 },
        { season: 2023, games: 1, played: 1, dnp: 0 },
        { season: 2024, games: 1, played: 1, dnp: 0 },
        { season: 2025, games: 19, played: 1, dnp: 18 },
        { season: 2026, games: 10, played: 10, dnp: 0 },
      ],
    });
    expect(stat(tracker, "passing_yards", { type: "season", season: 2026 })).toBe(2624);
    expect(stat(tracker, "passing_tds", { type: "season", season: 2022 })).toBe(2);
    // 2,624 this season, plus 185 + 220 + 231 + 277 before it.
    expect(stat(tracker, "passing_yards", { type: "seasons", from: 2022, to: 2026 })).toBe(3537);
    expect(stat(tracker, "passing_tds", { type: "seasons", from: 2022, to: 2026 })).toBe(29);
    expect(stat(tracker, "passing_yards", { type: "game", gameId: GAME })).toBe(255);
  });

  it("logs this season's games, with DNP for a game he has no nflverse line in", async () => {
    const entries = await published([highlights, seasonStats, missYouLetter, reason], withCareer(purdySatOut));
    const tracker = trackerOf(entries);
    const log = tracker?.type === "purdy-stat-tracker" ? tracker.data.gameLog : [];

    expect(log).toHaveLength(10);
    expect(log.at(-1)).toEqual({
      gameId: GAME,
      gameWeek: "2026-week-11",
      week: 11,
      gameType: "REG",
      opponent: "MIN",
      venue: "neutral",
      result: { sf: 35, opponent: 10 },
      played: false,
    });
    expect(log.filter((game) => game.played)).toHaveLength(9);
    expect(tracker?.data).toMatchObject({ seasons: expect.arrayContaining([{ season: 2026, games: 10, played: 9, dnp: 1 }]) });
    expect(stat(tracker, "passing_yards", { type: "season", season: 2026 })).toBe(2369);
    expect(stat(tracker, "passing_yards", { type: "game", gameId: GAME })).toBeUndefined();
  });

  it("fails the run when nflverse has none of his lines for an earlier season, rather than call it all DNP", async () => {
    const missing2023 = withCareer(snapshot);
    missing2023.stats = { ...missing2023.stats!, players: missing2023.stats!.players.filter((line) => line.season !== 2023) };

    await expect(runPostGame([highlights, seasonStats, loveLetter, reason], missing2023)).rejects.toThrow(/no nflverse lines for Brock Purdy in the 2023 season/);
  });

  it("leaves the tracker as it stands when the sources didn't collect his career lines", async () => {
    expect(trackerOf(await published([highlights, seasonStats, loveLetter, reason]))).toBeUndefined();
  });

  it("refuses a stat tracker from the writer", async () => {
    const forged: DraftEntry = { type: "purdy-stat-tracker", data: {}, body: "" };
    const writer: ContentWriter = { write: async () => [highlights, seasonStats, loveLetter, reason, forged] };
    const result = await publish({ job: "post-game", date: DATE, sources: fakeSources(withCareer(snapshot)), writer });

    expect(result.status === "rejected" && result.failures).toEqual([
      { check: "schema", entry: "purdy-stat-tracker", reason: "the post-game job doesn't write a purdy-stat-tracker on 2026-11-23" },
    ]);
  });
});
