// Publish check: every stat a piece cites must match nflverse. A content type that states stats
// lists each of them in its `stats` field as a cited stat (src/content/cited-stat.ts): who, which
// nflverse column, over what scope, and the value. The check looks each one up in the snapshot's
// nflverse lines and compares, at the precision the value is stated at. Pure: it reads only the
// entries and the snapshot.
import type { CitedStat } from "../../content/cited-stat";
import { describeStat, statValue } from "../stats";
import type { CheckFailure } from "../types";
import type { PublishCheck } from "./check";

export const statsMatchNflverse: PublishCheck = async ({ entries, snapshot }) =>
  entries.flatMap((entry): CheckFailure[] => {
    const cited: CitedStat[] = ("stats" in entry.data && entry.data.stats) || [];
    const fail = (reason: string): CheckFailure => ({ check: "nflverse-stats", entry: entry.path, reason });
    if (cited.length === 0) return [];
    if (!snapshot.stats) return [fail("the source snapshot has no nflverse stats")];

    return cited.flatMap((stat) => {
      const found = statValue(snapshot.stats!, stat);
      if ("error" in found) return [fail(`${describeStat(stat)}: ${found.error}`)];
      if (matches(stat.value, found.value)) return [];
      return [fail(`${describeStat(stat)}: draft says ${stat.value}, nflverse says ${round(found.value, 2)}`)];
    });
  });

/** nflverse's value, rounded to as many decimal places as the cited value has, is the cited value. */
function matches(cited: number, actual: number): boolean {
  const places = Math.min((String(cited).split(".")[1] ?? "").length, 6);
  return Math.abs(round(actual, places) - cited) < 1e-9;
}

export function round(value: number, places: number): number {
  const factor = 10 ** places;
  return Math.round(value * factor + Number.EPSILON * Math.sign(value)) / factor;
}
