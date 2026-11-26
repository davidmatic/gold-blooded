// The real sources for the Thursday preview job: the day's news snapshot (Preferred Sources
// and the official injury report, collected as the daily news job collects them) plus the
// 49ers' schedule from nflverse, which places the date on the calendar. The schedule is
// required: without it the run fails.
import type { Job, SourceAdapter, SourceSnapshot } from "../../types";
import { parseSchedule, SCHEDULE_URL } from "./schedule";
import { fetchWithBotUserAgent, realSources, type FetchPage } from "./sources";

export interface PreviewSourcesOptions {
  fetchPage?: FetchPage;
  /** Collects the day's news and injury report. Defaults to the real news sources. */
  news?: SourceAdapter;
  log?: (message: string) => void;
}

export function previewSources(options: PreviewSourcesOptions = {}): SourceAdapter {
  const fetchPage = options.fetchPage ?? fetchWithBotUserAgent;
  const news = options.news ?? realSources({ fetchPage, ...(options.log && { log: options.log }) });

  return {
    async collect(job: Job): Promise<SourceSnapshot> {
      const [snapshot, schedule] = await Promise.all([news.collect({ type: "daily-news", date: job.date }), fetchSchedule()]);
      return { ...snapshot, date: job.date, schedule };
    },
    linkResolves: (url) => news.linkResolves(url),
  };

  async function fetchSchedule() {
    const page = await fetchPage(SCHEDULE_URL).catch((error: unknown) => {
      throw new Error(`could not fetch the nflverse schedule (${SCHEDULE_URL}): ${error instanceof Error ? error.message : error}`);
    });
    if (page.status < 200 || page.status > 299) throw new Error(`could not fetch the nflverse schedule (${SCHEDULE_URL}): HTTP ${page.status}`);
    return parseSchedule(page.body);
  }
}
