# gold-blooded

Gold Blooded, an unofficial 49ers fan site. Static Astro site deployed to GitHub Pages at
https://davidmatic.github.io/gold-blooded/ (see `docs/adr/0001-static-site-with-scheduled-ai-content.md`).

## Local development

Requires Node 22.23.4+ (`.nvmrc` pins 24).

```sh
npm install
npm run dev      # local dev server
npm test         # vitest: built-site tests
npm run build    # static output in dist/
```

## Layout

- `src/pages/`: Astro routes, one per section (every section has a real page).
- `src/layouts/`, `src/components/`: shared layout, header nav, and the disclaimer footer.
- `src/site/`: plain TypeScript site config (sections, base-path links, content folder).
- `src/content/`: content type schemas (e.g. `news-summary.ts`), shared by the site's content
  collections (`src/content.config.ts`) and the publish pipeline.
- `src/pipeline/`: the publish pipeline. `publish()` in `publish.ts` is its single entry point (the
  spec's Seam 1); `runJob()` also writes the entries to the content folder when the run is published.
  `adapters/real/` holds the real adapters: `sources.ts` fetches the Preferred Sources into a source
  snapshot (parsing lives in `parsers.ts`), and `claude-writer.ts` writes News Summaries with Claude.
  `adapters/fixture.ts` holds fixture adapters that serve recorded sources and canned drafts.
  `calendar.ts` is calendar resolution, shared by every job that depends on the calendar (see
  Calendar below). `content-types.ts` says, per content type, which schema validates a draft, which
  fields the pipeline fills in, and where the entry is filed. The Thursday preview job's real adapters
  are `adapters/real/thursday-preview-sources.ts` (the news snapshot plus the nflverse schedule, parsed in
  `schedule.ts`) and `adapters/real/claude-game-preview-writer.ts`. The post-game job's are
  `adapters/real/post-game-sources.ts` (with the official YouTube feeds in `youtube.ts`) and
  `adapters/real/claude-post-game-writer.ts`. Every Claude writer makes its request through
  `adapters/real/claude.ts` (see Claude writer).
- `scripts/publish.ts`: CLI the workflows run, e.g.
  `npx tsx scripts/publish.ts daily-news --adapters real --date 2026-11-25` (`--adapters fixture`, the
  default, needs no network or key). Exits non-zero, writing nothing, when any publish check fails.
- `src/podcasts/`: podcast feeds, Whisper transcription, and the transcript cache (see Podcasts).
  Independent of any job type, so the daily news sources and the Film Room share it.
- `scripts/smoke-daily-news.ts`: manual smoke test for the real adapters (see below).
- `scripts/smoke-podcasts.ts`: manual smoke test for podcast transcription.
- `scripts/transcribe.py`: transcribes one audio file with faster-whisper (called from Node).
- `data/transcripts/`: the transcript cache, committed (one JSON file per episode).
- `content/`: the content store (Markdown + data files). Override with `GOLD_BLOODED_CONTENT_DIR`.
  To fix or remove a published piece, edit or delete its file. News Summaries live in `content/news/`.
  Each Game Week has a folder, `content/game-weeks/<slug>/` (slugs like `2026-week-12` or
  `2025-wild-card`), with one file per part: `preview.md` (the Game Preview) and
  `stat-breakdown.md` (the Stat Breakdown), or `season-recap.md` (a Bye Week's recap), and once
  the game is played, `highlights.md` (its Highlights). Its Game Week Page is
  `/game-weeks/<slug>/`. Season Stats are one file per season, `content/season-stats/<season>.md`,
  shown at `/season-stats/` (see Post-game). Each Offseason has a folder,
  `content/offseason/<year>/`, with its two running documents, `free-agency-tracker.md` and
  `draft-coverage.md` (see Offseason).
- `test/`: tests. `test/support/built-site.ts` builds the site against a fixture content folder in
  `test/fixtures/<name>/` and exposes the generated HTML (the spec's Seam 2). `test/support/fakes.ts`
  has the fake source and writer adapters for pipeline tests (Seam 1), which serve the recorded
  snapshots in `test/fixtures/snapshots/`. `test/fixtures/sources/` holds trimmed captures of the real
  source pages and feeds, which the parser and real-source tests read through a fake fetcher.
  Tests never touch the network or Claude.

## Sources

The daily news job (`adapters/real/sources.ts`) collects the job's day and the day before, in
Pacific time:

| Source | What | If it fails |
|---|---|---|
| 49ers.com `team/injury-report/` | the official injury report, as structured lines (`snapshot.injuryReport`) and as a document | run fails |
| 49ers.com `team/transactions/` | the day's transactions | run fails |
| 49ers.com `rss/news` | news articles, full text | run fails (one article that won't load falls back to its feed description) |
| 49ers.1rmg.com `transcripts/` | press conference transcripts, full text | run fails (one transcript that won't load is skipped) |
| NBC Sports Bay Area feed | articles, full text | skipped, run goes on |
| ESPN team news API (team 25) | 49ers stories, full text | skipped, run goes on |
| San Francisco Chronicle 49ers section | articles, full text | best effort: skipped when bot-blocked, run goes on |
| 49ers Talk, Jonnydel's Football Academy (RSS) | newest 2 episodes per show, transcribed with Whisper | skipped (feed or episode), run goes on |

Skipped outlets are listed in `snapshot.skipped`. Pro Football Reference is never scraped. Articles
already cited by a published News Summary are left out, so the same story isn't summarised twice.
Every fetch, and the source-link check, sends one honest User-Agent:
`gold-blooded-bot/1.0 (+https://davidmatic.github.io/gold-blooded/)`. The link check counts a link as
loading only on a 2xx with a body that isn't a bot-challenge page (ESPN answers some clients with an
empty 202).

## Podcasts

`src/podcasts/` is the reusable unit. `podcastTranscripts({ fetchPage, transcriber, cacheDir })`
returns an object whose `latest(podcast, { limit, from?, to?, exclude? })` reads the show's feed
(`PODCASTS.ninersTalk`, `PODCASTS.jfa`), picks its newest episodes in the window, and returns each as
a `PodcastEpisode` (show, hosts, title, date, episode page link, audio link, show notes) with its
`transcript`, or a `transcriptError` when transcription failed. Episode links are the Buzzsprout
episode page (JFA) or the Apple Podcasts episode page, matched by guid (49ers Talk, whose feed has no
per-episode page).

- **Transcriber**: `whisperTranscriber()` downloads the audio and runs `scripts/transcribe.py`
  (faster-whisper `small.en`, int8 on CPU, VAD filter, the show's names as the initial prompt).
  Set `WHISPER_PYTHON` and `WHISPER_MODEL` to override. Tests use a fake transcriber.
- **Cache**: each transcript is saved as `data/transcripts/<show id>/<guid>.json` and committed, so an
  episode is transcribed once, ever, by any workflow or local run. The daily workflow commits new
  transcripts even when its publish is rejected.

The daily news job adds each transcribed episode from the news window as a document marked with its
show and hosts. Podcast News Summaries must name the show and a host (the `podcast-attribution`
publish check) and cite the episode link, and their quotes are checked word for word against the
transcript.

## Claude writer

`adapters/real/claude-writer.ts` sends the snapshot to `claude-opus-5-5` through `@anthropic-ai/sdk`,
with a neutral news voice prompt and structured output matching the News Summary schema (including
the `injuries` and `quotes` the publish checks verify). Every writer (news, Game Preview, Offseason,
post-game) makes its requests through `claudeAsker()` in `adapters/real/claude.ts`: a voice prompt
(cached), a brief, and a Zod schema for the structured output, at effort `medium`, with the API's
server-side refusal fallback (`fallbacks: "default"`). Transient errors are retried twice; reaching
the spend limit fails the run at once with a "spend limit reached" error, and is never retried.
What the writers share is defined once, in `adapters/real/writer-output.ts`: the structured-output
shapes of sources, quotes, and injury statuses (and turning them into draft fields), the
`<document>` rendering of the snapshot's documents, and the prompt rules every voice states the
same way (`SHARED_RULES` and its parts).

## Publish checks

Every job runs the checks in `src/pipeline/checks/`; any failure rejects the whole run. Besides
the ones described with their jobs below:

- **Quotes** (`quotes.ts`). Every listed quote must be word for word in the document it cites. So
  that no quotation skips that, every quotation in the prose of a type that carries `quotes` (the
  title, body, and free-text fields) must be listed: any span in double quotes, curly (“…”) or
  straight ("…"), of two words or more. Single quotes are ignored (they are mostly apostrophes),
  and so is a scare-quoted single word (the “juice” package). A span counts as listed when it is
  part of a listed quote's text, ignoring case and the punctuation around it.
- **Injury mentions** (`injury-mentions.ts`, News Summaries and Love Letters). A body that uses
  injury words (injury, hurt, questionable, injured reserve, ...) must state at least one status
  in `injuries`, which the `injury-status` check holds to the official report. So a summary can't
  report an injury the official report doesn't give. (A roster move to injured reserve for a
  player the week's report doesn't list is rejected too, by design: it can't be checked.)
- **Numbers** (`numbers.ts`, every job). Cited stats are checked against nflverse, but prose
  can state numbers too, so every number in an entry's prose (title, body, storylines, keys,
  trends, write-ups, an Offseason update's new details, notes, and profiles) must be grounded:
  - one of the entry's cited stats, rounded to the decimal places the prose uses (164.7 may read
    as 165, never as 160);
  - in the text of a source document the entry cites (its `sources`, a Film Room entry's link);
    this is how draft rounds and picks, jersey numbers, ages, and contract terms pass;
  - a score or record the pipeline fills in: the entry's final score, a Game Preview's predicted
    score, the entry's record; or, written as a pair (35-10, 9-1), any final score on the schedule
    or the 49ers' record in a season so far.

  Not stats, so left out: years (1920 to 2099), dates (Nov. 25, 11/25, 2026-11-25), clock times
  (1:25), Week numbers (Week 13, Weeks 14-15), quarters and downs (4th quarter, 3rd-and-2, Q4), the
  "49ers" in the team's name, and Markdown list numbering. Numbers spelled out in words aren't
  read. Every writer's voice prompt states the rule (`NUMBERS_RULE` in
  `adapters/real/writer-output.ts`).

## Secrets and cost

The workflows read the Anthropic API key from the `ANTHROPIC_API_KEY` repository secret. To set it up:

1. In the [Claude Console](https://platform.claude.com/), create a dedicated workspace for Gold
   Blooded (the Default workspace can't have a spend limit), and create an API key in it.
2. Set its spend limit to **$20/month**: Console → Settings → Spend limits → Workspace limits.
3. Add the key to the repo: GitHub → Settings → Secrets and variables → Actions → New repository
   secret, name `ANTHROPIC_API_KEY`. Or: `gh secret set ANTHROPIC_API_KEY -R davidmatic/gold-blooded`.

One daily run sends roughly 30 documents (about 40K input tokens) and gets a few thousand tokens
back, a few tens of cents a day at Opus 5.5 prices, so it stays under the cap. When the cap is hit,
the API refuses requests; the daily job then fails with "Anthropic spend limit reached", commits
nothing, and the site keeps its previous version until the limit resets or is raised.

## Calendar

`resolveCalendar(date, schedule)` in `src/pipeline/calendar.ts` places a Pacific date on the 49ers'
nflverse schedule (`games.csv`, which has no preseason games):

- **Game Week**: from the day after one game through the day of the next, naming the upcoming and
  previous game. Each playoff game is its own Game Week. A season's first Game Week starts six days
  before kickoff.
- **Bye Week**: when the schedule skips a week. It runs from the day after the previous game until
  seven days before the next one, where that game's Game Week begins.
- **Offseason**: every other date, including the preseason and the time after the last scheduled game.

A job opts in through its `writes` entry in `publish.ts`'s `JOBS` registry: given the calendar
position, it returns the content types to write (none means nothing to do). The pipeline puts the
position on `job.calendar` for the writer, and needs `snapshot.schedule` from the sources.

## nflverse stats and cited stats

Outside the Offseason, the Thursday preview sources add the season's nflverse week-level stats to
the snapshot (`snapshot.stats`), fetched and parsed in `adapters/real/nflverse-stats.ts`:
`stats_player_week_<season>.csv` (one line per player per game; a player with no recorded stats in a
game has no line) and `stats_team_week_<season>.csv` (one line per team per game). Every numeric
column is kept under its nflverse name. Before a season's first stats are out (HTTP 404) the stats
are empty and listed in `snapshot.skipped`; any other fetch failure fails the run.

Content that states stats lists every number in a `stats` array of **cited stats**
(`src/content/cited-stat.ts`), the way News Summaries list their quotes:

```yaml
- player: "Brock Purdy"   # left out for a team stat
  team: "SF"              # nflverse abbreviation
  stat: "passing_yards"   # an nflverse column, or completion_pct, yards_per_attempt, yards_per_carry, yards_per_reception
  scope: { type: "season", season: 2026 }   # or { type: "game", gameId }, or { type: "last-games", season, games }
  per: "game"             # optional: a per-game average instead of a total
  value: 262.4
  label: "Passing yards"
```

`statValue()` in `src/pipeline/stats.ts` works a cited stat out from the week lines (season and
last-N totals, per-game averages, the derived rates; rate columns such as `passing_cpoe` only for
one game). The `nflverse-stats` publish check (`checks/nflverse-stats.ts`) rejects any cited stat
nflverse can't give, or whose value differs once nflverse's number is rounded to the decimal places
the cited value has. The Stat Breakdown's stats must be about SF or that week's opponent; the
Claude writer gets both teams' lines and totals in its brief, worked out by the same `statValue()`.

## Offseason

The `offseason` job (`.github/workflows/offseason.yml`, daily) writes the Free Agency Tracker
and Draft Coverage on every Offseason day, and nothing in the season. Game content jobs write
nothing in the Offseason; News Summaries carry on in the daily news job.

- **Running documents.** Each Offseason (named by its NFL Draft's year: the 2026 Offseason
  follows the 2025 season) has one Free Agency Tracker and one Draft Coverage, updated run after
  run. The sources (`adapters/real/offseason-sources.ts`) read each document as it stands into
  `snapshot.current`; the writer (`adapters/real/claude-offseason-writer.ts`, one Claude call for
  both) returns only what is new or corrected, plus a fresh overview; and the pipeline folds that
  in (`src/pipeline/running-documents.ts`). Lists only grow: a move is replaced only by one for the
  same player and kind, a pick by one with the same overall number. Team needs are replaced when
  the update gives any. `sources` lists what the latest update drew on. To remove an item or fix
  one, edit the file.
- **Publish check.** Besides the usual checks, every item an update adds (a move, mock draft, pick,
  or profile) must cite a document in the snapshot that names the player (`offseason-sources`).
- **Homepage.** In the Offseason the Game Preview slot shows the Free Agency Tracker, or Draft
  Coverage around the draft: from **21 days before the draft's first day through 7 days after its
  last** (`homepageWindow` in `data/nfl-drafts.json`). The latest update date stands for "today",
  and the slot goes back to the Game Preview once one newer than that update is published.
- **Draft dates.** `data/nfl-drafts.json` lists each NFL Draft's dates; the pipeline copies them
  into Draft Coverage. A year not listed is estimated as the fourth Thursday of April through the
  Saturday after. Add each year's real dates once the NFL announces them.
- Pages: `/free-agency-tracker/` and `/draft-coverage/` show the newest Offseason's documents.

## Post-game

The `post-game` job (`.github/workflows/post-game.yml`, daily) writes when the most recent 49ers
game was played in the last three days and its Highlights aren't in the content store yet
(`gameToCover()` and `POST_GAME_DAYS` in `calendar.ts`; the sources set
`snapshot.highlightsPublished` when the Highlights file exists). Normally that is Monday after a
Sunday game, Tuesday after a Monday night game, Friday after a Thursday night game, and the day
after the season's last game, though that day is already the Offseason. A run that failed
(nflverse late with the game's stats) is caught up by the next day's run, up to three days after
the game; once the Highlights are published, later runs write nothing, so a game is never written
twice (a re-run's Prediction Record replaces the game's earlier score, as before). Every other day
it fetches only the schedule and writes nothing. If the schedule has no final score for the game
yet, the run fails before asking Claude.

- **Highlights** (`content/game-weeks/<slug>/highlights.md`, on the game's own Game Week Page):
  3 to 5 standouts, each with a write-up and a stat line, plus the final score and up to three
  official clips. Each standout's stat line is the cited stats with his name (`scope` the game),
  so the `nflverse-stats` check covers them; the schema rejects a stat from any other game and a
  standout with no stat line.
- **Season Stats** (`content/season-stats/<season>.md`, at `/season-stats/`): rewritten after every
  game. The 49ers' season totals as cited stats (`team: SF`, `scope` the season); the pipeline fills
  in the record and the game the numbers run through.
- **Sources** (`adapters/real/post-game-sources.ts`): when a game is due, the day's news snapshot
  (game recaps, postgame press conferences), the season's nflverse stats, and the official clips.
  The stats must already include the game; if nflverse hasn't posted them yet the run fails, and
  the next day's run tries again. Past three days, run it by hand for a date within three days of
  the game (Actions → Post-game → Run workflow, with the date).
- **Official clips.** `adapters/real/youtube.ts` reads the RSS feeds of the official
  [San Francisco 49ers](https://www.youtube.com/channel/UCeIOarQkwmGhimim9cDUTng) and
  [NFL](https://www.youtube.com/channel/UCDVYQ4Zhbm3S2dlz7P1GBDg) YouTube channels (15 newest
  videos each, no API key) into `snapshot.videos`: videos posted since kickoff, and from the NFL's
  channel only those that mention the 49ers. Best effort: a feed that won't load is skipped. The
  `official-clips` publish check rejects any embedded clip whose id isn't in `snapshot.videos`, so
  the writer can't embed an id it made up. The page embeds clips with YouTube's privacy-enhanced
  player (`youtube-nocookie.com`).
- **Extending it.** Later post-game content adds its content type to `POST_GAME_CONTENT` in
  `publish.ts`, an entry to `POST_GAME_WRITERS` in `claude-post-game-writer.ts` (voice, schema,
  brief, draft), and whatever it needs to the post-game sources' snapshot.

## Purdy Shrine

The Shrine (`/purdy-shrine/`, `src/content/purdy-shrine.ts`) lives in `content/purdy-shrine/`.
It stays family-friendly and never covers Purdy's personal life or family (the writer voices say
so). The post-game job writes three of its four parts:

- **DNP.** `purdyPlayed()` in `src/pipeline/purdy.ts` decides whether Purdy played a game from
  the schedule and his nflverse lines (a game with no player line for him is a DNP). The writer
  never decides it. When the game's 49ers team line is missing, the run fails rather than guess.
- **Love Letter** (`love-letters/<gameWeek>.md`, one per game, its own page under
  `/purdy-shrine/love-letters/`, and the newest on the homepage). The pipeline owns `variant`:
  `adoring` when he played, `we-miss-you` on a DNP. A writer's own `variant` is overwritten. Any
  number is a cited stat of his (`nflverse-stats` check). Any injury status is in `injuries`
  (`injury-status` check against the official report). The `injury-mentions` check rejects a
  letter whose body uses injury words (injury, hurt, questionable, ...) without stating a
  status, so a letter can't speculate past the report.
- **Reasons We Love Brock** (`reasons.md`, a running document). The writer returns one new
  `reason`. The pipeline appends it with the date and Game Week, and keeps the file's body (a
  hand-written introduction). The schema rejects a reason the list already has, and one with
  digits (a reason has no cited stats to check). The post-game sources read the list from the
  content folder. A list that fails its schema fails the run.
- **Stat tracker** (`stat-tracker.md`). Derived by the pipeline (`derive`, no Claude call) after
  every game: games, played, and DNP for each season since 2022, his season and career numbers
  (career is the cited-stat scope `{ type: "seasons", from: 2022, to: <season> }`), and this
  season's game log with DNP games. Every number is a cited stat, so the stat check covers the
  tracker too. The post-game sources add his lines from each earlier season's nflverse player
  file (only his are kept) and set `snapshot.purdyCareer`. A season's file that won't load fails
  the run. Without `purdyCareer` the tracker is left as it stands.
- **Origin story** (`origin-story.md`, "Mr. Irrelevant to Mr. Everything"). Written by hand.
  Edit the file to change it.
- **Purdy in the Film Room.** The Purdy-tagged Film Room entries, newest first
  (`shrineFilmRoom()` in `src/site/film-room.ts`), shown by `PurdyFilmRoom.astro`, each linking to
  its place on the Film Room page and to the original. Hidden when there are none (see Film Room).

## Film Room

The Film Room job (`.github/workflows/film-room.yml`, daily) writes one short, credited entry per
new breakdown to `content/film-room/<date>-<slug>.md` (`src/content/film-room.ts`), shown at
`/film-room/`, with the newest on the homepage.

- **Sources** (`adapters/real/film-room-sources.ts`), looking back 7 days and leaving out any
  breakdown an entry already links to: The QB School's YouTube feed (videos about the 49ers only,
  up to 3) and Jonnydel's Football Academy's newest episodes (up to 2), transcribed through
  `src/podcasts/` with the shared transcript cache. A feed that won't load is skipped.
- **QB School captions are best effort** (`adapters/real/captions.ts`, yt-dlp, 120 s timeout, no
  cookies). When YouTube blocks the runner, the entry is written from the video's title and
  description (`transcribed: false`, and the page says so), and the run goes on. A JFA episode
  Whisper can't transcribe falls back to its show notes the same way.
- **The writer** (`claude-film-room-writer.ts`) gives the title, body, `link`, `purdy`, and any
  quotes. The pipeline fills in `show`, `medium`, `sourceTitle`, `publishedAt`, and `transcribed`
  from the source, so a link that isn't one of the run's breakdowns fails its schema. With no new
  breakdowns there is no Claude call.
- **Checks**, besides source links, quotes, and podcast attribution (a JFA entry must name the
  show and Jonnydel): `film-room-coverage` (every breakdown gets exactly one entry) and
  `film-room-purdy` (a `purdy: true` tag needs both the source, by its title, description, or
  transcript, and the entry to name Purdy; only tagged entries appear in the Shrine).
- `scripts/smoke-film-room.ts` checks the real sources (and with `--claude`, the writer) by hand.

## Smoke test

The real adapters have no unit tests that touch the network or Claude. Check them by hand:

```sh
# Sources only (network, no key): prints every document, the injury report, and skipped outlets.
npx tsx scripts/smoke-daily-news.ts

# End to end: real sources, Claude, and every publish check. Writes nothing to content/.
ANTHROPIC_API_KEY=sk-ant-... npx tsx scripts/smoke-daily-news.ts --claude

# Optionally keep the published entries somewhere to look at them.
ANTHROPIC_API_KEY=sk-ant-... npx tsx scripts/smoke-daily-news.ts --claude --out /tmp/gb-news
```

`scripts/smoke-thursday-preview.ts` does the same for the Thursday preview job (sources only, it
prints where the date falls on the calendar; `--claude` writes the Game Preview or season recap).
`scripts/smoke-offseason.ts` does the same for the Offseason job (`--claude` writes both running
documents' updates; it reads the current ones from `content/` or `--content-dir`).
`scripts/smoke-post-game.ts` does the same for the post-game job (sources only, it prints the game
it covers, the stats it found, and the official clips; `--claude` writes the Highlights and
Season Stats). Give it a date one to three days after a game, e.g. `--date 2026-11-23`.

They all take `--date YYYY-MM-DD` (default: today, Pacific). Add `--podcasts` to
`smoke-daily-news.ts` to transcribe the news window's podcast episodes too (needs Python 3.12 with `pip install -r scripts/requirements-whisper.txt`).

Podcast transcription alone (network and Whisper, no key). It transcribes the newest episode
whatever its date and prints the time taken and the transcript's start:

```sh
python3.12 -m venv .venv-whisper && .venv-whisper/bin/pip install -r scripts/requirements-whisper.txt
WHISPER_PYTHON=.venv-whisper/bin/python npx tsx scripts/smoke-podcasts.ts --show 49ers-talk
WHISPER_PYTHON=.venv-whisper/bin/python npx tsx scripts/smoke-podcasts.ts --show jfa
```

The full check is one real run of the daily
news workflow (Actions → Daily news → Run workflow): its News Summaries pass the checks, are
committed to `main`, and appear on the live site's News page.

## Deploy

`.github/workflows/deploy.yml` tests, builds, and deploys to Pages on every push to `main`.
Pull requests run the tests and build only. Content workflows call it via `workflow_call` after
they commit, because pushes made with `GITHUB_TOKEN` don't trigger the push event.

The content workflows share two composite actions in `.github/actions/`: `setup-whisper` (Python
3.12, faster-whisper, and the cached Whisper model, for the jobs that transcribe podcasts) and
`commit-content` (commits the content folder when the run was published, and with
`transcripts: true` the transcript cache whatever the outcome; it outputs the commit's sha only
when content changed, which is what starts the deploy).

`.github/workflows/daily-news.yml` runs the daily news job every morning. A published result is
committed to `main` and deployed; a rejected one fails the run (GitHub emails the owner) and commits
nothing. It uses the real adapters and the `ANTHROPIC_API_KEY` secret.

`.github/workflows/thursday-preview.yml` runs the Thursday preview job every Thursday morning, after
the Wednesday injury report: a Game Preview and Stat Breakdown in a Game Week, a season recap in a Bye Week, and nothing
(no commit, no deploy) in the Offseason. Same commit, deploy, and failure behaviour as daily news.

`.github/workflows/offseason.yml` runs the Offseason job every morning, after daily news: it
updates the Free Agency Tracker and Draft Coverage in the Offseason, and does nothing (no commit,
no deploy) in the season. Same commit, deploy, and failure behaviour as daily news.

`.github/workflows/post-game.yml` runs the post-game job every day at 10am/11am Pacific: after a
game (up to three days after, until its Highlights are published) it writes the Highlights, Season
Stats, and the Purdy Shrine's share, and otherwise does nothing (no commit, no
deploy). Same commit, deploy, and failure behaviour as daily news.
