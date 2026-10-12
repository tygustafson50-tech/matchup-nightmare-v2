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

## Player photos, team logos, and injury designations

Every verified player-prop card now draws its player headshot and medical/availability designation from the **exact ESPN athlete verified on that game's participating rosters**. It also displays **both team logos** from the authoritative ESPN game schedule record, without matching players to photos by ambiguous names. Only HTTPS ESPN CDN image URLs are rendered. When a photo or logo cannot be retrieved, a readable player/team initials placeholder remains in its place.

Where ESPN lists an injury, the card displays the reported **Questionable, Doubtful, Out, Injured reserve, Day-to-day / game-time decision, Probable, or Injury reported** designation and available injury details. A roster with an explicitly empty injury list shows **No injury listed**, not "Healthy". Missing status data shows **Status not confirmed**. The last ESPN roster check time is displayed on new scans. **ESPN roster injuries are not a guaranteed up-to-the-minute game-day inactive report**; verify official injury reports and lineups before relying on availability.

The last-scan quota fallback stores the photos/logos and designation with the original scanned cards but labels saved injury data **Saved: … / not rechecked**. No additional PropLine requests are made to obtain these images or roster statuses. The source/line, one-stat-per-player rule, and three-season matching logic are unchanged.

## All-sport scan repair (NFL, NBA, MLB, college football/basketball, soccer)

Real player props must be retrieved from PropLine's documented
`/v1/sports/{sport}/events/{event_id}/odds` endpoint, **not** the
bulk `/odds` endpoint primarily used for game lines. The scanner first
discovers the exact sport's upcoming events, intersects that day's events
with the **up to 16 ESPN fixtures you selected**, and then queries only those
events for actually offered OVER markets at the one configured sportsbook
(**DraftKings**). It refuses to fabricate unposted lines, never substitutes
another book, caps event fetches, and reports events checked and missing
sources to explain empty scan results. The narrower event requests use more
than one API call per scan, so the existing free-tier quota and previously
saved-scan fallback remain important.

ESPN scoreboard discovery includes non-ranked NCAA football (FBS) and
Division I men's basketball teams. NBA and NCAA basketball roster/box-score
generic G/F position categories can now be reconciled with verified roles.
ESPN MLB box score `statistics` categories often omit the category name;
batting and pitching are resolved from their **actual recorded AB/IP
columns**. NBA, MLB, and NCAA sports retain existing verified three-season
position/stat defenses; when a season contains fewer than five distinct
verified opposing teams, the engine falls back to comparing independently
observed pregame position-specific allowed and usage **raw rates**. This is
explicitly identified as a limited verified sample and is never labeled a
league-wide rank. MLB batter comparisons no longer require guessed opposing
pitcher handedness.

Soccer's game summary uses `summary.rosters[].roster[].stats` rather than
`summary.boxscore.players`; the ESPN parser reads actual individual goals,
assists, shots, shots on target, fouls, tackles, and saves when named values
exist. MLS follows calendar-year seasons; European league seasons cross
calendar years. There is no invented performance for players or games whose
source does not publish a recorded statistic.

**Bookmaker coverage limitation:** PropLine's published DraftKings coverage
includes MLB, NBA, NFL, NCAA football and some soccer leagues, but does
**not** list NCAA men's basketball player props under DraftKings. With
DraftKings enforced as the **only** sportsbook, a college-basketball game may
be visible on the ESPN calendar while **no DraftKings player line is
available**. The app must show that lack of real market coverage rather
than invent a line or imply an API key error. PropLine lists Bovada as
supporting all 57 sports including NCAA basketball; switching the sole
sportsbook to Bovada would require an explicit product choice.
Off-season sports similarly have no new scheduled games/props on some dates.
