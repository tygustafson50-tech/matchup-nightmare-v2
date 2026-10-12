# Matchup Nightmare — PropLine Edition

The existing black-and-gold six-sport app now uses **PropLine's documented REST API v1** for live player-prop **OVER** quotes from named sportsbooks. No PrizePicks integration, custom invented lines, or manually derived alternative thresholds are required. Alternative props are displayed only if actually quoted by a source sportsbook.

## Set up your free PropLine key

1. Get a free API key: https://prop-line.com/pricing (PropLine currently advertises **1,000 API requests/day** on Free).
2. Open the Cloudflare dashboard for **matchup-nightmare-v2** → **Settings** → **Variables and Secrets** (Cloudflare's menu wording may vary).
3. Add the secret **PROPLINE_API_KEY** with the value of your actual PropLine API key. Set it for the **Production** environment; add it to Preview only if you intentionally test there.
4. Redeploy the latest GitHub `main` deployment if the setting does not take effect automatically. Don't commit an API key to GitHub or send it in chat.
5. Visit https://matchup-nightmare-v2.pages.dev/ and scan a scheduled game with current player-prop markets.

**Without the key**, `/api/lines` responds `503 integration-required`; the UI explains what's needed and displays **no fabricated predictions**. There is no built-in shared or demo API key.

## Source details

The Cloudflare Pages Function `functions/api/lines.js` makes authenticated requests with the header **X-API-Key** to:

- `GET https://api.prop-line.com/v1/sports` to verify supported sport keys.
- `GET https://api.prop-line.com/v1/sports/{sport_key}/odds?markets=...&includeBookIds=true` to fetch current **bulk** player-prop markets from sportsbook feeds.

The response is filtered to genuinely quoted **Over** outcomes with numeric points, a documented market key, a fresh `last_update` within 30 minutes, a supported book, and the correct Central-time game date. Source/provider event identity, sportsbook name and odds, exact line, and alternate/main line type are retained. DFS and prediction/exchange pricing is intentionally excluded.

For supported games, existing ESPN public sources are used to confirm the athlete's identity, current team and playing position against **both** official participating rosters before comparing the quote with recorded game data. Missing role, roster, game log or boxscore evidence is excluded or labeled incomplete — not guessed. If the PropLine fixture cannot be uniquely matched to the selected ESPN game, no prop is analyzed.

Recent-game evidence uses the five latest verified current-season player game results. The similar-defense engine scans the current season plus the previous two seasons and uses the same player statistic, position-specific conceded stats and pregame defensive comparison, normalizing against available independently verified season cohorts. Only verifiable similar opponents are included; the number of samples is explicit.

**No historical line is claimed to have been offered at the time of a past game.** Those real game results are compared with the exact current sportsbook point. No historical 100% rate is a guarantee of a future result.

## Source changes and refresh

The app rechecks verified quotes periodically while the board is open, clearing outdated cards if an offer changes or disappears. Optional `PROJECTION_SNAPSHOTS` KV binding supports cross-refresh change tracking; without a KV namespace, historical line-change tracking is labeled unavailable. To avoid burning through the free tier, the endpoint uses one bulk odds call per sport instead of one odds call per game; the UI also shows PropLine's remaining daily request quota when available.

## Testing

Run `npm test` in Node 20+ for source-line, coverage, API-secret, date/fixture, recent-game, defensive-history, and UI regressions. GitHub Actions automatically tests pull requests.

**Limitations:** The API key is not configured automatically; Cloudflare secret setup must be completed by the project owner. PropLine sports and books vary by season and league, so some selected games may have no available player props. The independently verified three-season defensive matchups still rely on provisional, incomplete public ESPN box scores — missing samples remain missing. A successful deployment or unit test is not proof of a live integrated scan.
