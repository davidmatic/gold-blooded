// The Film Room job through the publish pipeline (Seam 1): credited, linked entries for new
// QB School videos and JFA episodes. Fake sources and a fake writer; no network, no Claude.
import { describe, expect, it } from "vitest";
import { publish, type DraftEntry, type SourceDocument, type SourceSnapshot } from "../../src/pipeline";
import { fakeSources, fakeWriter } from "../support/fakes";

const DATE = "2026-11-25";
const QB_VIDEO = "https://www.youtube.com/watch?v=qbPurdy0001";

/** A QB School video whose captions couldn't be fetched: its text is the description alone. */
const uncaptionedVideo: SourceDocument = {
  url: QB_VIDEO,
  outlet: "The QB School",
  title: "Brock Purdy vs the Vikings Week 11, 2026 Analysis",
  publishedAt: "2026-11-24T17:00:00.000Z",
  text: "Breaking down Brock Purdy's three touchdowns against Minnesota in Mexico City.",
  film: {
    show: "The QB School",
    medium: "video",
    description: "Breaking down Brock Purdy's three touchdowns against Minnesota in Mexico City.",
    transcribed: false,
  },
};

const snapshot = (documents: SourceDocument[]): SourceSnapshot => ({ date: DATE, documents });

function run(documents: SourceDocument[], drafts: DraftEntry[], options: { deadLinks?: string[] } = {}) {
  return publish({ job: "film-room", date: DATE, sources: fakeSources(snapshot(documents), options), writer: fakeWriter(drafts) });
}

const qbDraft: DraftEntry = {
  type: "film-room",
  data: { title: "Purdy's three touchdowns in Mexico City", link: QB_VIDEO, purdy: true },
  body: "The QB School walks through how Purdy carved up Minnesota.",
};
const QB_PATH = "film-room/2026-11-25-purdy-s-three-touchdowns-in-mexico-city.md";

const KITTLE_VIDEO = "https://www.youtube.com/watch?v=qbKittle002";
const kittleVideo: SourceDocument = {
  url: KITTLE_VIDEO,
  outlet: "The QB School",
  title: "George Kittle's blocking, explained",
  publishedAt: "2026-11-24T20:00:00.000Z",
  text: "Kittle seals the edge on the outside zone, and the 49ers run game takes off.",
  film: { show: "The QB School", medium: "video", description: "How the 49ers tight end changes the run game.", transcribed: true },
};
const kittleDraft: DraftEntry = {
  type: "film-room",
  data: { title: "Kittle's blocking", link: KITTLE_VIDEO, purdy: false },
  body: "The QB School shows how Kittle seals the edge.",
};
const KITTLE_PATH = "film-room/2026-11-25-kittle-s-blocking.md";

const JFA_EPISODE = "https://www.buzzsprout.com/2047939/episodes/18200001";
const jfaEpisode: SourceDocument = {
  url: JFA_EPISODE,
  outlet: "Jonnydel's Football Academy",
  title: "Victory Monday: 49ers handle the Vikings",
  publishedAt: "2026-11-23T16:00:00.000Z",
  text: "What a game. Purdy is throwing with anticipation. That is the difference this year.",
  podcast: { show: "Jonnydel's Football Academy", hosts: ["Jonnydel"] },
  film: { show: "Jonnydel's Football Academy", medium: "podcast", description: "Jonnydel breaks down the win.", transcribed: true },
};

describe("the Film Room job", () => {
  it("publishes an entry from a video's title and description when its captions couldn't be fetched", async () => {
    const result = await run([uncaptionedVideo], [qbDraft]);

    expect(result).toEqual({
      status: "published",
      entries: [
        {
          type: "film-room",
          path: "film-room/2026-11-25-purdy-s-three-touchdowns-in-mexico-city.md",
          data: {
            title: "Purdy's three touchdowns in Mexico City",
            date: DATE,
            show: "The QB School",
            medium: "video",
            link: QB_VIDEO,
            sourceTitle: "Brock Purdy vs the Vikings Week 11, 2026 Analysis",
            publishedAt: "2026-11-24T17:00:00.000Z",
            transcribed: false,
            purdy: true,
          },
          body: "The QB School walks through how Purdy carved up Minnesota.",
        },
      ],
    });
  });

  it("is rejected when an entry tags Purdy but the breakdown never mentions him", async () => {
    const result = await run([kittleVideo], [{ ...kittleDraft, data: { ...kittleDraft.data, purdy: true }, body: "Kittle and Purdy, in sync." }]);

    expect(result).toEqual({
      status: "rejected",
      failures: [{ check: "film-room-purdy", entry: KITTLE_PATH, reason: `tagged as about Brock Purdy, but its source (${KITTLE_VIDEO}) never mentions Purdy` }],
    });
  });

  it("is rejected when an entry tags Purdy but its summary never mentions him", async () => {
    const result = await run([uncaptionedVideo], [{ ...qbDraft, data: { ...qbDraft.data, title: "Three touchdowns in Mexico City" }, body: "A great breakdown of Minnesota's defense." }]);

    expect(result).toEqual({
      status: "rejected",
      failures: [{ check: "film-room-purdy", entry: "film-room/2026-11-25-three-touchdowns-in-mexico-city.md", reason: "tagged as about Brock Purdy, but its summary never mentions Purdy" }],
    });
  });

  it("publishes an untagged entry about another player", async () => {
    const result = await run([kittleVideo], [kittleDraft]);

    expect(result.status).toBe("published");
  });

  it("is rejected when a breakdown gets no entry, or two", async () => {
    const missing = await run([uncaptionedVideo, kittleVideo], [qbDraft]);
    const twice = await run([uncaptionedVideo], [qbDraft, { ...qbDraft, data: { ...qbDraft.data, title: "Again" } }]);

    expect(missing).toEqual({
      status: "rejected",
      failures: [{ check: "film-room-coverage", entry: KITTLE_VIDEO, reason: `The QB School's "George Kittle's blocking, explained" has no Film Room entry` }],
    });
    expect(twice).toEqual({
      status: "rejected",
      failures: [{ check: "film-room-coverage", entry: QB_VIDEO, reason: `The QB School's "Brock Purdy vs the Vikings Week 11, 2026 Analysis" has 2 Film Room entries` }],
    });
  });

  it("is rejected when an entry links to something that isn't one of the run's breakdowns", async () => {
    const result = await run([uncaptionedVideo], [qbDraft, { ...kittleDraft, data: { ...kittleDraft.data, show: "The QB School" } }]);

    expect(result.status).toBe("rejected");
    if (result.status !== "rejected") return;
    expect(result.failures).toContainEqual(expect.objectContaining({ check: "schema", entry: KITTLE_PATH }));
  });

  it("credits a JFA episode to the show and Jonnydel, and quotes its transcript word for word", async () => {
    const quote = { text: "Purdy is throwing with anticipation.", speaker: "Jonnydel", source: JFA_EPISODE };
    const credited: DraftEntry = {
      type: "film-room",
      data: { title: "Jonnydel on Purdy's anticipation", link: JFA_EPISODE, purdy: true, quotes: [quote] },
      body: `On Jonnydel's Football Academy, Jonnydel says, "${quote.text}"`,
    };
    const uncredited: DraftEntry = { ...credited, data: { ...credited.data, quotes: [] }, body: "Purdy is throwing early." };
    const misquoted: DraftEntry = { ...credited, data: { ...credited.data, quotes: [{ ...quote, text: "Purdy is the best ever." }] } };

    const published = await run([jfaEpisode], [credited]);
    expect(published.status).toBe("published");
    if (published.status === "published") {
      expect(published.entries[0]!.data).toMatchObject({ show: "Jonnydel's Football Academy", medium: "podcast", transcribed: true, purdy: true });
    }
    expect(await run([jfaEpisode], [uncredited])).toMatchObject({ status: "rejected", failures: [{ check: "podcast-attribution" }] });
    expect(await run([jfaEpisode], [misquoted])).toMatchObject({ status: "rejected", failures: [{ check: "quotes" }] });
  });

  it("is rejected when the original's link doesn't load", async () => {
    const result = await run([uncaptionedVideo], [qbDraft], { deadLinks: [QB_VIDEO] });

    expect(result).toEqual({
      status: "rejected",
      failures: [{ check: "source-links", entry: "film-room/2026-11-25-purdy-s-three-touchdowns-in-mexico-city.md", reason: `source link does not load: ${QB_VIDEO}` }],
    });
  });
});
