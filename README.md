# Matchup Nightmare — PropLine Edition

The existing black-and-gold six-sport app now uses **PropLine's documented REST API v1** for live player-prop **OVER** quotes from **DraftKings only**. No PrizePicks integration, custom invented lines, or manually derived alternative thresholds are required. Alternative DraftKings lines are considered only when actually quoted; exactly **one** evidence-selected OVER line is displayed per verified player/stat/game, even when multiple actual alt points are available.

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

Recent-game evidence uses the five latest verified current-season player game results.

**Simplified NFL similar-defense matchups (new):** For every NFL stat, look up the upcoming opponent's ESPN **rushing defense rank** (rush yards, carries, rushing TDs) or **passing defense rank** (passing yards/completions/attempts/TDs, targets, receptions, receiving yards/TDs). ESPN's official team /statistics?season=YEAR returns reported opponent-statistic ranks in `results.opponent`, including `rushingYards` and `netPassingYards`. For each of the player's real recorded games in **the current season and the previous two seasons**, look up that historical opponent's own season rushing or passing defensive rank. A game counts as a similar matchup only when that rank is **within ±3 of the upcoming opponent's reported defensive rank**. E.g. a #28 passing defense matches ranks #25–#31 (not #24 or #32). For each matching game, show the actual year, opponent, result against the **current DraftKings line**, and both verified defensive ranks.

These ranks are **ESPN opponent team statistics**, with #1 indicating lower net passing/rushing yards allowed by ESPN's season aggregate ranking. **Historical season rankings may include games played after the individual historical matchup**; this is explicitly disclosed as a limitation and the app must not call those historical numbers pregame rankings. Missing ranks do not count as comparable games or a 100% history. This simpler rank model currently applies to **NFL only**. NBA, college football, college basketball, MLB, and soccer retain their existing sport-specific defensive modeling.

All similar-defense history stays within the sport's three-season window and maintains explicit real sample size.

**No historical line is claimed to have been offered at the time of a past game.** Those real game results are compared with the exact current sportsbook point. No historical 100% rate is a guarantee of a future result.

## Source changes and refresh

The app rechecks verified quotes periodically while the board is open, clearing outdated cards if an offer changes or disappears. Optional `PROJECTION_SNAPSHOTS` KV binding supports cross-refresh change tracking; without a KV namespace, historical line-change tracking is labeled unavailable. To avoid burning through the free tier, the endpoint uses one bulk odds call per sport instead of one odds call per game; the UI also shows PropLine's remaining daily request quota when available.

## Testing

Run `npm test` in Node 20+ for source-line, coverage, API-secret, date/fixture, recent-game, defensive-history, and UI regressions. GitHub Actions automatically tests pull requests.

**Limitations:** The API key is not configured automatically; Cloudflare secret setup must be completed by the project owner. PropLine sports and books vary by season and league, so some selected games may have no available player props. The independently verified three-season defensive matchups still rely on provisional, incomplete public ESPN box scores — missing samples remain missing. A successful deployment or unit test is not proof of a live integrated scan.

## One sportsbook, one card per player/stat

PropLine remains the API provider, but only actual **DraftKings** OVER quotes are used. Other bookmakers are ignored, even when their markets are available. Main and alternative DraftKings lines for the same athlete, game, and exact statistic are evaluated against the same verified historical results; only one strongest-evidenced quote is displayed. The chosen quote still has its real sportsbook line and price. A second canonical fixture/ESPN athlete-ID check prevents alternate markets with different source event IDs from producing duplicates. Missing DraftKings prices must remain missing; no substitute or invented line from another book is allowed.

## When the free PropLine request limit is reached

After a **successful** scan, the app automatically saves completed player-prop
research for each selected *upcoming* game in the same browser's local storage.
This includes the exact previously sourced DraftKings quotes, recorded game
samples, calculated hit rates, and original timestamps.

If PropLine responds with HTTP **429 / rate-limited**, or signals zero free
requests remaining, Matchup Nightmare does not invent replacement lines.
It automatically reopens the last saved scan for the **same sport, league,
calendar date, and game ID**, with an obvious **LAST SAVED SCAN — NOT LIVE**
warning. It labels each saved quote with the old bookmaker timestamp and
original scan time; an old OVER research suggestion is presented as
**previously supported**, not a currently tradable/bookable quote. A player
stat still has exactly one card.

No saved scan for another match/date will be used, and previous odds will no
longer appear after the game's scheduled start or seven days after saving,
whichever comes first. If only some selected games were previously scanned,
results appear only for those games and the missing games are disclosed.
If there is no compatible saved scan, the app clearly reports that condition
instead of manufacturing lines. The app avoids repeated provider calls after
detecting exhaustion; reload the page after your quota resets to attempt
fresh quotes again.

**Important**: Saving takes effect only **after this update** and only if
at least one completed research card was produced before the free quota
ran out. The cache lives in that browser/device, not your PropLine account.
Private browsing, clearing website data, browser storage restrictions, or
changing devices can make it unavailable. This does not bypass API quotas
or guarantee an unchanged sportsbook line.
