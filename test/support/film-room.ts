// Film Room content for the built-site tests (Seam 2), written by the publish pipeline: two Film
// Room runs with fake adapters, one for a QB School video whose captions couldn't be fetched.
// Of the three entries, only the Purdy video's is Purdy-tagged.
import { runJob, type DraftEntry, type SourceDocument } from "../../src/pipeline";
import { fakeSources, fakeWriter } from "./fakes";

export const SHANAHAN_VIDEO = "https://www.youtube.com/watch?v=qbNiners002";
export const PURDY_VIDEO = "https://www.youtube.com/watch?v=qbPurdy0001";
export const JFA_EPISODE = "https://www.buzzsprout.com/2047939/episodes/20168779";

const shanahanVideo: SourceDocument = {
  url: SHANAHAN_VIDEO,
  outlet: "The QB School",
  title: "How Kyle Shanahan Schemes Receivers Open",
  publishedAt: "2026-11-21T17:00:00.000Z",
  text: "Shanahan uses play-action to move the linebackers, and the window opens behind them.",
  film: { show: "The QB School", medium: "video", description: "The 49ers' play-action game, frame by frame.", transcribed: true },
};
const purdyVideo: SourceDocument = {
  url: PURDY_VIDEO,
  outlet: "The QB School",
  title: "Brock Purdy vs the Vikings Week 11, 2026 Analysis",
  publishedAt: "2026-11-24T17:00:00.000Z",
  text: "Breaking down Brock Purdy's three touchdowns against Minnesota in Mexico City.",
  film: { show: "The QB School", medium: "video", description: "Breaking down Brock Purdy's three touchdowns against Minnesota in Mexico City.", transcribed: false },
};
const jfaEpisode: SourceDocument = {
  url: JFA_EPISODE,
  outlet: "Jonnydel's Football Academy",
  title: "JFA Podcast 355: Victory Monday",
  publishedAt: "2026-11-23T16:00:00.000Z",
  text: "The three amigos were the story. McCaffrey and Kittle did whatever they wanted.",
  podcast: { show: "Jonnydel's Football Academy", hosts: ["Jonnydel"] },
  film: { show: "Jonnydel's Football Academy", medium: "podcast", description: "Jonnydel breaks down the win.", transcribed: true },
};

const shanahan: DraftEntry = { type: "film-room", data: { title: "Shanahan's play-action, frame by frame", link: SHANAHAN_VIDEO, purdy: false }, body: "The QB School shows how play-action opens windows." };
const purdy: DraftEntry = { type: "film-room", data: { title: "Purdy's three touchdowns in Mexico City", link: PURDY_VIDEO, purdy: true }, body: "The QB School breaks down Purdy's three touchdown throws." };
const jfa: DraftEntry = { type: "film-room", data: { title: "The three amigos", link: JFA_EPISODE, purdy: false }, body: "On Jonnydel's Football Academy, Jonnydel credits McCaffrey and Kittle." };

/** Publishes the Film Room entries into the content folder. */
export async function publishFilmRoom(contentDir: string): Promise<void> {
  const runs: [string, SourceDocument[], DraftEntry[]][] = [
    ["2026-11-22", [shanahanVideo], [shanahan]],
    ["2026-11-25", [purdyVideo, jfaEpisode], [jfa, purdy]],
  ];
  for (const [date, documents, written] of runs) {
    const result = await runJob({ job: "film-room", date, sources: fakeSources({ date, documents }), writer: fakeWriter(written), contentDir });
    if (result.status !== "published") throw new Error(JSON.stringify(result));
  }
}
