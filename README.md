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
