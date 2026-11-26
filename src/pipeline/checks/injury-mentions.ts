// Publish check: a News Summary or a Love Letter may talk about an injury only as far as the
// official NFL injury report goes. Any injury language in its body needs at least one status in
// `injuries`, which the injury-status check then holds to the official report; so a piece can't
// speculate about an injury the report doesn't list. Pure: it reads only the entries.
import type { CheckFailure, ContentType } from "../types";
import type { PublishCheck } from "./check";

const INJURY_WORDS = /\b(injur\w*|hurt\w*|questionable|doubtful|injured reserve|concussion|sprain\w*|strain\w*|fractur\w*|surgery|rehab\w*)\b/i;

/** The content types the check covers, by the name its failure gives. */
const CHECKED: Partial<Record<ContentType, string>> = { "news-summary": "News Summary", "love-letter": "Love Letter" };

export const injuryMentionsStated: PublishCheck = async ({ entries }) =>
  entries.flatMap((entry): CheckFailure[] => {
    const name = CHECKED[entry.type];
    if (!name) return [];
    const mention = entry.body.match(INJURY_WORDS)?.[0];
    const injuries = ("injuries" in entry.data && entry.data.injuries) || [];
    if (!mention || injuries.length > 0) return [];
    return [
      {
        check: "injury-mentions",
        entry: entry.path,
        reason: `the ${name} mentions an injury ("${mention}") but states no injury status from the official report in injuries`,
      },
    ];
  });
