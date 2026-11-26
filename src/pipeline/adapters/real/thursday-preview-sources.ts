// The real sources for the Thursday preview job: the day's news snapshot (Preferred Sources
// and the official injury report, collected as the daily news job collects them) plus the
// 49ers' schedule from nflverse, which places the date on the calendar. The schedule is
// required: without it the run fails. Outside the Offseason it also adds the season's nflverse
// player and team stats, for the Stat Breakdown and the stat publish check.
import { resolveCalendar } from "../../calendar";
import type { Job, SourceAdapter, SourceSnapshot } from "../../types";
import { fetchNflverseStats } from "./nflverse-stats";
import { fetchSchedule } from "./schedule";
import { fetchWithBotUserAgent, realSources, type FetchPage } from "./sources";

export interface ThursdayPreviewSourcesOptions {
  fetchPage?: FetchPage;
  /** Collects the day's news and injury report. Defaults to the real news sources. */
  news?: SourceAdapter;
  log?: (message: string) => void;
}

export function thursdayPreviewSources(options: ThursdayPreviewSourcesOptions = {}): SourceAdapter {
  const fetchPage = options.fetchPage ?? fetchWithBotUserAgent;
  const news = options.news ?? realSources({ fetchPage, ...(options.log && { log: options.log }) });

  return {
    async collect(job: Job): Promise<SourceSnapshot> {
      const [snapshot, schedule] = await Promise.all([news.collect({ type: "daily-news", date: job.date }), fetchSchedule(fetchPage)]);
      const calendar = resolveCalendar(job.date, schedule);
      if (calendar.period === "offseason") return { ...snapshot, date: job.date, schedule };
      const { stats, skipped } = await fetchNflverseStats(fetchPage, calendar.season);
      return { ...snapshot, date: job.date, schedule, stats, ...(skipped && { skipped: [...(snapshot.skipped ?? []), skipped] }) };
    },
    linkResolves: (url) => news.linkResolves(url),
  };
}
