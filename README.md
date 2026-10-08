# Matchup Nightmare V2

A six-sport, OVER-only sports research web app: NFL, NBA, MLB, NCAA men's football, NCAA men's basketball, and men's soccer.

## Publish this as a free website (Cloudflare Pages)

Your repository **can stay private**. Cloudflare Pages can deploy it automatically when code is updated on GitHub.

1. Visit https://dash.cloudflare.com/ and create/sign in to a **Free** account.
2. Navigate to **Workers & Pages** → **Create** → **Pages** → **Connect to Git** (labels may vary).
3. Authorize access to GitHub and select `tygustafson50-tech/matchup-nightmare-v2`.
4. Choose **Framework preset: None**.
5. Leave the **Build command empty** (no build is required).
6. Set **Build output directory: public**.
7. Set **Production branch: main**, then deploy.
8. Cloudflare will give you a `*.pages.dev` website address. Open that URL in your browser.

The `functions/api/games.js` file provides the schedule API on Cloudflare. `public/lib/engine.js` provides the browser research calculations. **No Node installation or Replit credits are required to visit the website.**

The site's URL can be public even when the GitHub source code is private. This is not a password-protected service.

## What is currently implemented

- A unified black-and-gold interface with six sports (soccer has multiple leagues).
- Public ESPN scoreboard schedules when available (unofficial API).
- Up to 16 game selections and Central Time display.
- Clearly labeled **manual** game log entry for player research.
- OVER line calculation and last-5 / last-10 / all-entered-game trends.
- A preliminary comparable-opponent check using **broad team scoring allowed**, not true defense-vs-position.
- Historical 100% filtering requiring three comparable recorded games.

## Important current limitations

This is a **research starter**, not a finished automated scanner. It does **not** have verified automatic player game logs, true similar-defense-versus-position modeling, sportsbook props or alternative odds lines, injuries, calibrated projections, or automatically generated betting picks. It must not fill data gaps with invented statistics.

ESPN public scoreboard data is unofficial, may have missing games, and may be blocked or changed without notice. Treat it as a provisional schedule source.

## Optional: Run the local server

Install Node.js 20+, run `npm start` in the project folder, and visit http://localhost:3000. For the live Cloudflare website, Node installation on your PC is unnecessary.

To test the research calculations locally: `npm test`.

## Next development milestones

1. Verify and integrate affordable, authorized historical player-game data for all six sports.
2. Implement sport-specific defensive similarity algorithms using pregame data and minimum samples.
3. Connect licensed player-prop and alternative-line feeds.
4. Add reproducible date-scoped backtests, uncertainty, and data integrity checks.

Historical 100% hit rates do not mean guaranteed betting outcomes.

## Automatic selected-game OVER scanning (V2.1)

**No player stats need to be typed for automatic scans.**

1. Open the deployed Cloudflare Pages website.
2. Select one of six sports, date, and up to 16 games.
3. Under **Scan settings**, leave **Both: similar defenses + recent games** selected. You may narrow it to either mode.
4. Click **Scan Selected Games**.
5. The site attempts to pull real completed-team game schedules and game-by-game player boxscores for the selected teams. It constructs possible OVER research thresholds and shows qualifying sample sizes and actual historical game statistics.

The scanner displays two **separately labeled** types of historical 100% research:
- **100% SIMILAR:** over threshold exceeded in *every qualifying comparable previous matchup*, with a minimum of three games. Similarity is currently based on opponents' pregame TEAM points/goals allowed per game, within a ±30% range of the upcoming opponent, not defense versus position.
- **100% RECENT:** over threshold exceeded in every available recent player appearance used (at least three appearances, four needed before candidate generation). This is **not opponent-similarity filtering**.

The scanner derives the highest basic half-step threshold below the historical sample minimum; this deliberately finds thresholds that clear the observed sample and does **not** mean there is an edge at real sportsbook odds. Trivial/unsupported markets are filtered, and missing values are not changed to 0. This is not a projected probability.

**No PrizePicks API or sportsbook odds feed is connected yet.** Every displayed threshold is explicitly **RESEARCH-ONLY**, **not** a currently offered PrizePicks or alternate betting line. It would be dishonest to claim live PrizePicks odds from an unrelated boxscore source. An authorized real market feed is required to compare against actual offered lines.

### Data gaps and reliability

The scan uses public, undocumented ESPN team schedules and game summaries, which can be unavailable or change without notice. Cloudflare might be rate-limited on repeated scans, especially 16-game batches. A failed or empty scan does not imply there are no profitable props. College and soccer player boxscore coverage may be incomplete. Team-score similarity is a preliminary baseline: richer defensive-against-position, role, usage, injury, and odds data is still required for a strong betting model.

Code:
- \`functions/api/scan.js\` — selected-game schedule and boxscore data ingestion.
- \`lib/auto-scan.js\` — strict per-sport player-stat parsing and 100% historical threshold calculation.
- \`public/app.js\` — Scan Selected Games button, progress updates, results and drill-down history.
- \`tests/auto-scan.test.js\` — parsing and safety regression tests.

Cloudflare will redeploy changes pushed to \`main\` automatically. If you see an old layout, wait for deployment to finish, then use Ctrl+Shift+R to hard refresh.

## Player-card update: Last 4 vs similar defenses

The six-sport scan cards now show **two fully visible game-by-game tables**:

- **Last 5 games:** Date, opponent, actual recorded stat for the selected market, and OVER/BELOW/PUSH status.
- **Last 4 matchups vs similar defenses:** The four **most recent historical opponents whose pregame team scoring allowed was within 30% of the upcoming opponent's baseline**, showing the same date, opponent, actual stat and OVER/BELOW/PUSH status. A separate count (e.g. 3 of 4 available) accurately reports incomplete comparison history. No missing game is fabricated.

The backend searches as many as ten previous completed team games, since qualifying similar opponents can be older than the player's last five. A 100% **similar** trend uses the displayed comparable sample of 3–4 games; a 100% **recent** trend uses its own last-five sample, and its similar-defense comparison may include misses. The two are never conflated. The comparison is currently broad **team defensive scoring allowed**, not defense versus the player's position, coverage, or role.

Cloudflare automatically redeploys the site after commits to main. Hard-refresh once the deployment finishes.
