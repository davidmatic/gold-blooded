// Publish check: every YouTube clip a piece embeds must be one of the official 49ers or NFL
// channels' videos in the source snapshot (from their RSS feeds), so the writer can never embed
// a video id it made up, or one from anyone else's channel. Pure: it reads only the entries and
// the snapshot.
import type { CheckFailure } from "../types";
import type { PublishCheck } from "./check";

export const clipsAreOfficial: PublishCheck = async ({ entries, snapshot }) => {
  const official = new Set((snapshot.videos ?? []).map((video) => video.videoId));
  return entries.flatMap((entry) =>
    (("clips" in entry.data && entry.data.clips) || [])
      .filter((clip) => !official.has(clip.videoId))
      .map(
        (clip): CheckFailure => ({
          check: "official-clips",
          entry: entry.path,
          reason: `clip ${clip.videoId} is not one of the official 49ers or NFL YouTube videos in the source snapshot`,
        }),
      ),
  );
};
