// Publish check: every injury status a News Summary states must match the official NFL
// injury report in the source snapshot. Pure: it reads only the entries and the snapshot.
import type { CheckFailure, InjuryReportEntry } from "../types";
import type { PublishCheck } from "./check";

export const injuryStatusesMatch: PublishCheck = async ({ entries, snapshot }) => {
  const report = new Map((snapshot.injuryReport ?? []).map((line) => [playerKey(line.player), line]));
  return entries.flatMap((entry): CheckFailure[] => {
    const injuries = entry.data.injuries ?? [];
    if (injuries.length > 0 && !snapshot.injuryReport) {
      return [{ check: "injury-status", entry: entry.path, reason: "the source snapshot has no official injury report" }];
    }
    return injuries.flatMap((stated): CheckFailure[] => {
      const fail = (reason: string) => [{ check: "injury-status", entry: entry.path, reason: `${stated.player}: ${reason}` }];
      const official: InjuryReportEntry | undefined = report.get(playerKey(stated.player));
      if (!official) return fail("not on the official injury report");
      for (const field of ["practiceStatus", "gameStatus"] as const) {
        const label = field === "practiceStatus" ? "practice status" : "game status";
        if (stated[field] && stated[field] !== official[field]) {
          return fail(`draft says ${label} ${stated[field]}, official injury report says ${official[field] ?? "none"}`);
        }
      }
      return [];
    });
  });
};

/** Matches a draft's spelling of a name with the report's: "C.J. West Jr." is "cj west". */
function playerKey(name: string): string {
  return name
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[.'’]/g, "")
    .replace(/\b(jr|sr|ii|iii|iv|v)\b/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}
