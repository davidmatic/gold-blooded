// Pure parsers behind the real source adapter: raw pages and feeds in, snapshot pieces out.
// The fixtures in test/fixtures/sources/ are trimmed captures of the real sources (2026-11-25).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  isBotChallenge,
  parseArticlePage,
  parseEspnNews,
  parseInjuryReport,
  parseRssFeed,
  parseSfcSection,
  parseTranscriptListing,
  parseTransactions,
} from "../../src/pipeline/adapters/real/parsers";

const fixture = (name: string) => readFileSync(new URL(`../fixtures/sources/${name}`, import.meta.url), "utf8");

describe("49ers.com injury report", () => {
  it("reads each player's latest practice status, and no game status while it is UNSPECIFIED", () => {
    const report = parseInjuryReport(fixture("49ers-injury-report.html"));

    expect(report).toHaveLength(15);
    expect(report).toContainEqual({ player: "Brock Purdy", practiceStatus: "DNP" });
    expect(report).toContainEqual({ player: "Keenan Allen", practiceStatus: "LP" });
    expect(report).toContainEqual({ player: "Romello Height", practiceStatus: "FP" });
  });

  it("takes the latest day's practice status and the final game status", () => {
    const html = fixture("49ers-injury-report.html")
      .replace(/<td>DNP<\/td><td><\/td><td><\/td><td class="nfl-o-injury-report__game-status">UNSPECIFIED/, () =>
        '<td>DNP</td><td>LP</td><td>FP</td><td class="nfl-o-injury-report__game-status">QUESTIONABLE');

    expect(parseInjuryReport(html)[1]).toEqual({ player: "Mike Evans", practiceStatus: "FP", gameStatus: "Questionable" });
  });
});

describe("49ers.com transactions", () => {
  it("dates each transaction, taking the year from the job date", () => {
    const transactions = parseTransactions(fixture("49ers-transactions.html"), "2026-11-25");

    expect(transactions[0]).toEqual({
      date: "2026-11-25",
      text: "The 49ers have activated CB Nate Hobbs from the Injured Reserve List, signed WR Brandin Cooks to the practice squad, and placed OL Colton McKivitz on the Injured Reserve List.",
    });
    expect(transactions.find((t) => t.text.includes("DeForest Buckner"))?.date).toBe("2026-10-28");
  });

  it("puts months after the job's month in the previous year", () => {
    const transactions = parseTransactions(fixture("49ers-transactions.html"), "2027-01-03");

    expect(transactions[0]!.date).toBe("2026-11-25");
  });
});

describe("RSS feeds", () => {
  it("reads 49ers.com news items with their links, titles, and dates", () => {
    const items = parseRssFeed(fixture("49ers-news.xml"));

    expect(items).toHaveLength(4);
    expect(items[0]).toEqual({
      url: "https://www.49ers.com/news/brock-purdy-named-nfc-offensive-player-of-the-week-following-mexico-city-win",
      title: "Brock Purdy Named NFC Offensive Player of the Week Following Mexico City Win",
      publishedAt: "2026-11-25T20:13:10.000Z",
      summary:
        "San Francisco 49ers quarterback Brock Purdy was named NFC Offensive Player of the Week after the team's Week 11 win over the Minnesota Vikings in Mexico City.",
    });
  });

  it("drops Spanish-language items from the 49ers.com feed", () => {
    const xml = fixture("49ers-news.xml").replace("English, English Articles", "Spanish, Español");

    expect(parseRssFeed(xml).map((item) => item.title)).not.toContain(
      "Brock Purdy Named NFC Offensive Player of the Week Following Mexico City Win",
    );
  });

  it("decodes NBC Sports Bay Area titles and reads its Pacific-time item dates", () => {
    const items = parseRssFeed(fixture("nbc-49ers.xml"));

    expect(items[0]).toMatchObject({
      url: "https://www.nbcsportsbayarea.com/nfl/san-francisco-49ers/nick-bosa-mexico-city-cheering/1983216/",
      title: "49ers' Nick Bosa clarifies ‘pure' intention behind Mexico City cheering comments",
      // "Wed, Nov 25 2026 06:36:28 PM" in Pacific time
      publishedAt: "2026-11-26T02:36:28.000Z",
    });
    expect(items[0]!.summary).toMatch(/^SANTA CLARA — On Wednesday, Nick Bosa clarified/);
  });
});

describe("press conference transcripts (49ers.1rmg.com)", () => {
  it("lists transcripts newest first, with their dates", () => {
    const listing = parseTranscriptListing(fixture("1rmg-transcripts.html"));

    expect(listing).toHaveLength(12);
    expect(listing[0]).toEqual({
      url: "https://49ers.1rmg.com/transcripts/head-coach-kyle-shanahan-press-conference-64/",
      title: "Head Coach Kyle Shanahan Press Conference",
      date: "2026-11-25",
    });
    expect(listing[3]).toMatchObject({ title: "QB Brock Purdy Press Conference", date: "2026-11-19" });
  });

  it("keeps a transcript's full text, questions and answers, word for word", () => {
    const { text } = parseArticlePage(fixture("1rmg-transcript-shanahan.html"));

    expect(text).toContain("Press Conference – November 25, 2026");
    expect(text).toContain("When did Brock get injured?\n“Second quarter.”");
    expect(text).toContain("“We’ll see. Concern today, couldn’t go.”");
    expect(text).toContain("It’s not a high ankle so it’s day-to-day with it, but we’ve got to see how it goes.");
  });
});

describe("article pages", () => {
  it.each([
    ["49ers-article.html", "QB Brock Purdy put on a show in Mexico City, and the NFL took notice."],
    ["espn-story.html", "SANTA CLARA, Calif. -- San Francisco 49ers quarterback Brock Purdy did not practice Wednesday"],
    ["nbc-article.html", "“I thought it was good,” Bosa said Wednesday about his reception at Estadio Banorte"],
    ["sfc-article.html", "Brock Purdy didn’t practice Wednesday because of an ankle injury."],
  ])("reads the body text of %s", (file, sentence) => {
    const page = parseArticlePage(fixture(file));

    expect(page.text).toContain(sentence);
    expect(page.text).not.toMatch(/<\/?[a-z]/i);
  });

  it("reads the headline and publish time from the page's metadata", () => {
    expect(parseArticlePage(fixture("sfc-article.html"))).toMatchObject({
      title: "49ers QB Brock Purdy held out of practice for ankle injury suffered in Mexico City game",
      publishedAt: "2026-11-25T23:15:46.000Z",
    });
  });
});

describe("San Francisco Chronicle (best effort)", () => {
  it("lists the 49ers section's article links once each", () => {
    const links = parseSfcSection(fixture("sfc-section.html"));

    expect(links).toHaveLength(5);
    expect(links[0]).toBe("https://www.sfchronicle.com/sports/49ers/article/sf-49ers-receivers-mike-evans-keenan-allen-22550375.php");
  });

  it("recognises the bot-challenge page, and doesn't mistake real pages for one", () => {
    expect(isBotChallenge(fixture("sfc-challenge.html"))).toBe(true);
    expect(isBotChallenge(fixture("sfc-section.html"))).toBe(false);
    expect(isBotChallenge(fixture("sfc-article.html"))).toBe(false);
  });
});

describe("ESPN team news", () => {
  it("keeps 49ers news stories, dropping video, game pages, betting, and league-wide posts", () => {
    const items = parseEspnNews(fixture("espn-49ers-news.json"));

    expect(items).toEqual([
      {
        url: "https://www.espn.com/nfl/story/_/id/50596930/49ers-brock-purdy-ankle-injury-practice-wednesday",
        title: "49ers QB Brock Purdy has ankle injury, sits out practice Wednesday",
        publishedAt: "2026-11-26T00:16:10.000Z",
        summary: expect.any(String),
      },
      {
        url: "https://www.espn.com/nfl/story/_/id/50578357/seahawks-holding-final-sam-darnold-call-vs-49ers",
        title: expect.stringContaining("Sam Darnold"),
        publishedAt: "2026-11-24T02:21:45.000Z",
        summary: expect.any(String),
      },
    ]);
  });
});
