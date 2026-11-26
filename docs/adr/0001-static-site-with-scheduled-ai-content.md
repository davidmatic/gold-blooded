# Static site with scheduled, auto-published AI-written content

Gold Blooded is a static site on GitHub Pages, built with Astro. Scheduled GitHub Actions jobs rebuild it: daily for News Summaries and the Film Room, the day after each game for Highlights, the Love Letter, and Season Stats, and on Thursday for the Game Preview and the Stat Breakdown. Claude writes all of this content from Preferred Sources. Podcast audio is transcribed with open-source Whisper on the job runner. Content goes live **without human review**. The only safeguard is a set of automated publish checks, and if any check fails, the site keeps its previous version:

- Every source link must load.
- Injury statuses must match the official NFL injury report.
- Quotes must appear word for word in their source.
- Stats must match nflverse.

We chose this because the site is a hobby. Content arrives several times a week, and nobody wants a daily review chore. The checks target the errors that would actually embarrass us: wrong injury news and made-up quotes.

## Considered Options

- **Review before publishing (a PR for each update)**: rejected because the review burden was too high for daily news. It is easy to bring back if auto-published content proves unreliable.
- **A backend or server**: rejected because no feature needs accounts, comments, or live data. Live in-game scores are explicitly out of scope.
- **Locked On 49ers as a source**: skipped because it is a daily show, which would add too much transcription time and cost.

## Consequences

- An Anthropic API key, with a $20/month spend cap, is stored as a GitHub secret.
- The QB School is best effort, since YouTube captions are often blocked from cloud runners. When they are, the Film Room falls back to the video's title and description, plus a link.
- The site is unofficial and non-commercial. It never uses the 49ers logo, the team wordmark, or copied photos. It does embed official YouTube videos and social posts.
