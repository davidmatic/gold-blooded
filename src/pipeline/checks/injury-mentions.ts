// Publish check: a Love Letter may talk about an injury only as far as the official NFL injury
// report goes. Any injury language in its body needs at least one status in `injuries`, which
// the injury-status check then holds to the official report; so a letter can't speculate about
// an injury the report doesn't list. Pure: it reads only the entries.
import type { CheckFailure } from "../types";
import type { PublishCheck } from "./check";

const INJURY_WORDS = /\b(injur\w*|hurt\w*|questionable|doubtful|injured reserve|concussion|sprain\w*|strain\w*|fractur\w*|surgery|rehab\w*)\b/i;

export const injuryMentionsStated: PublishCheck = async ({ entries }) =>
  entries.flatMap((entry): CheckFailure[] => {
    if (entry.type !== "love-letter") return [];
    const mention = entry.body.match(INJURY_WORDS)?.[0];
    if (!mention || (entry.data.injuries?.length ?? 0) > 0) return [];
    return [
      {
        check: "injury-mentions",
        entry: entry.path,
        reason: `the Love Letter mentions an injury ("${mention}") but states no injury status from the official report in injuries`,
      },
    ];
  });
