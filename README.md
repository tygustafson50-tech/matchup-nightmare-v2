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

**NFL verified defensive league rankings (baseline):** For every NFL stat, look up the upcoming opponent's ESPN **rushing defense rank** (rush yards, carries, rushing TDs) or **passing defense rank** (passing yards/completions/attempts/TDs, targets, receptions, receiving yards/TDs). ESPN's official team /statistics?season=YEAR returns reported opponent-statistic ranks in `results.opponent`, including `rushingYards` and `netPassingYards`. For each of the player's real recorded games in **the current season and the previous two seasons**, look up that historical opponent's own season rushing or passing defensive rank. A game counts as a similar matchup only when that rank is **within ±3 of the upcoming opponent's reported defensive rank**. E.g. a #28 passing defense matches ranks #25–#31 (not #24 or #32). For each matching game, show the actual year, opponent, result against the **current DraftKings line**, and both verified defensive ranks.

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

## Strict NFL similar defenses — 4–6 game evidence goal

For a **fresh NFL scan**, the old single-rank historical matching is upgraded
to a more selective, stat/position-specific comparison:

- **Passing and rushing together:** For passing/receiving markets, the
  upcoming opponent's verified ESPN net passing defensive rank must be
  within **three places** of the historical defense, and the rushing rank
  within **eight**. For rushing markets the primary and secondary ranks
  are reversed. Published yards allowed per game also must agree to within
  25% for the primary lane and 40% for the secondary lane.
- **Player role and actual opponent allowances:** Independently
  verify at least **three PRIOR completed box scores** for the upcoming
  and the historical defenses against the applicable QB/RB/WR/TE player
  group and chosen statistic. The relevant allowed rate per game must be
  within **35%** of the upcoming opponent's allowed rate. This compares
  real passing/rushing production, receiving totals or receptions
  surrendered to the actual position; it is not inferred from a generic
  passing-defense rank.
- **Short passing/checkdown context:** For *RB receiving markets*, the
  defensive record must also contain three prior opponent box scores with
  RB catches, and those RB receptions allowed averages must be within
  **35%**. For QB/WR/TE markets we display the RB-catch rate when verifiable
  as additional context. This **is only a proxy** for how favorable the
  defense is to passes completed to RBs. ESPN's public box scores do not
  identify which catches were genuine checkdowns or chart the depth of
  individual pass routes. Therefore the app never calls it an actual
  checkdown count or routes defended.

Only verified game results from the current and prior two seasons are used.
The scanner ranks qualifying historical games **only by defense fit, never
by whether the player hit the prop**, then displays up to the six closest
matches. It **requires at least four matches** for the "OVER supported"
designation and continues using the five most recent current-season games
separately. If fewer than four defensively similar games pass the strict
verification gates, the real smaller sample is shown and the card is marked
**insufficient evidence**, not forced into 4–6 or padded with weaker defenses.
No number of passing/rushing/checkdown historical hits is a guaranteed
future probability.

**Caveat:** The ESPN published team passing/rushing rankings are
season-to-date/current and full-season/historical aggregates. Historical
final-season ranks may incorporate games occurring after the historical
matchup. The **position-allowed** sample instead uses only games completed
before the matchup and labels its actual sample coverage. NFL strict
analysis can require significantly more public ESPN requests than the old
rank-only comparison, but does not use extra PropLine lines. Other sports
retain their existing models. Previously saved local scans remain marked
as stale until refreshed.

## Strict similar-defense matchups for every supported sport, position and prop

Every **fresh** NFL, college football, NBA, college basketball, MLB and soccer
player-prop scan now targets **four to six independently verified historical
games** from the current season plus the prior two seasons, while still showing
the player's separate **last five current-season games**. The app selects
historical games based exclusively on defensive/opponent-profile resemblance,
**not** which games happened to beat today's sportsbook line. It displays at
most six strongest valid comparisons and only marks an OVER supported when
**at least four** pass and the recent/similar hit-rate evidence is favorable.
If 0–3 pass, show the actual smaller sample and an insufficient-evidence note.
Never pad with weak or fabricated games, and never call historical hit rates
betting probabilities.

**NFL (QB/RB/WR/TE, across every ESPN-recorded market):** Passing or rushing
defensive rankings (primary rank ±3, other rank ±8), recorded yards allowed,
plus at least three **earlier completed game** box scores of what that defense
allowed to the relevant QB/RB/WR/TE group on the exact stat. RB receptions
allowed is available as a **short-pass/checkdown proxy** only, not verified
checkdown routes, average depth of target or coverage schemes. Never
manufacture target counts when ESPN omits them.

**College football:** Each specific QB/RB/WR/TE stat compares the observed
position allowance, usage volume and related on-field result (e.g., receiving
yards with receptions, rushing yards with rush attempts, passing yards with
completions). This is based on three or more *prior* ESPN box scores per
opponent. There is no unsupported claim of NFL-style full-league NCAA ranks.

**NBA and college basketball:** The exact ESPN-reported G/F/C or PG/SG/SF/PF/C
role's points, assists, rebounds, threes, PRA, steals or blocks is matched
against a similarly measured role allowance, field-goal attempt volume and
companion stat. These are recorded opposing-player outcomes, not invented
defensive rankings. Generic ESPN G/F labels are handled as role families.

**MLB:** Hitters' real hits, total bases, home runs, runs, RBIs or walks
compare the verified opponent pitcher-staff results versus batters, batting
opportunities and recorded companion stat. A **pitcher K** matchup measures
the upcoming opponent's own batting strikeouts/at-bats; **pitching outs**
uses the opponent's batting at-bats as an explicitly named **opportunity
proxy**, **not** as actual innings/outs conceded. Without verified source
fields, the model reports insufficient evidence instead.

**Soccer:** Recorded player-position shots, on-target shots, goals, assists,
tackles and fouls use the corresponding prior position group's recorded
results and a related stat. For **goalkeeper saves**, the opponent's own
shots on target and attempts measure **save opportunities**, not a guaranteed
save total. League-specific profiles are never mixed across competitions.

All non-NFL sports require prior source samples of three or more completed
games on both the upcoming and historical opponents, position-stat allowed
rate within 30%, relevant usage within 35%, and a verified related statistic
within 40%. Those thresholds are **research heuristics**, not validated
predictive odds. Each sourced game is annotated with the allowed rate and
supporting metric used. For all sports, historical box scores/defensive
contexts must be from before the historical matchup; where the older NFL
season-wide ranking may include later games, that limitation stays disclosed.

Live lines remain **DraftKings ONLY** via PropLine; no new data provider,
sportsbook or paid feed is required. Archived scans keep their old research
until the next successful fresh scan. Not all sports have active DraftKings
player-prop markets on every date, and the single-book college basketball
coverage limitation remains.

## Current similar-defense selection: 3–6 distinct opponents

The scanner now selects **3–6 unique verified defenses**, not 4–6
potentially repeated games. It still examines the same current and two
previous seasons. A qualifying historical opponent contributes only its
closest genuinely comparable player game (even if the player faced it more
than once); game results and sportsbook line comparisons are never invented
or selected according to past OVER outcomes.

- **NFL QB/RB/WR/TE markets:** the historical defense qualifies through
  verified ESPN *primary* pass/rush league rank within **five places OR**
  primary yards allowed per game within **10%** of the upcoming opponent.
  Secondary passing/rushing behavior cannot be radically different,
  and the position's prior recorded allowances remain required. RB catches
  allowed can inform the documented checkdown proxy but cannot demonstrate
  actual route coverage. NFL candidate search checks up to 24 verified
  rank/rate-eligible historical games with at most two seasons/games per
  opposing team before selecting unique qualified defenses.
- **NCAAF, NBA, NCAAB, MLB, soccer:** use ESPN-recorded role/stat
  allowances **within 10%**, or an independently verified strong alternate
  match in which usage is within 10%, role allowance within 20%, and the
  companion position-stat comparison within 20%. Existing three-game
  pre-matchup source-verification and within-league requirements still
  apply. These comparisons are **not** claimed to be sourced league-wide
  defensive ranks.
- **At least three distinct qualifying defenses** are required for a
  supported OVER recommendation, alongside the independent recent-game
  threshold and majority OVER hit rates. Only the best six are displayed.
  If ESPN cannot verify three distinct genuinely similar opponents,
  0–2 are shown as insufficient; the app never pads results or promises
  false always-available matches.

The hit counter in the closed Similar Defenses dropdown is recalculated
from the selected unique historical games. The recent five games remain
separate. Existing saved scans may still show results computed under the
older 4–6 rule until the user performs a fresh scan.

## October 2026: Zero verified similar defenses resolved

Live ESPN evidence exposed two concrete integration issues:

1. The NFL team schedule endpoint puts completed-game status under
   `event.competitions[0].status.type.completed`, not `event.status`.
   Previously even teams with 17 valid scheduled events had **zero**
   completed games in the defensive sample.
2. NFL game-summary box score athlete rows often have **no position**.
   The current-season team rosters do contain verified athlete IDs and
   RB/WR/QB/TE positions; the scanner now joins on those IDs before
   computing actual source-recorded positional allowances. ESPN older
   season rosters, notably 2025, can return **empty athlete lists**.

When a historical defense passes the verified ESPN rank-within-five or
yards-allowed-within-ten-percent rule but does not have enough source
position coverage, the scanner now retains it as a prominently disclosed
**rank/rate-only comparison**, not as a measured RB/WR/TE coverage match.
Every historical *player game stat* remains required to come from the real
ESPN box score, and missing stats are never padded with zero or fabricated.
Actually verified position-coverage comparisons rank ahead of rank-only
comparisons in the list. The card reports how many are rank-only. ESPN's
historical season-aggregate ranks may include later games.

Deep position enrichment is limited to **eight ranked candidates per
player**, prioritizing the current season where valid rosters exist. This
keeps excessive additional ESPN traffic down while allowing the verified
rank/rate fallback to search all historical verified opponents.

**Verification:** A live public ESPN diagnostic for Matthew Stafford
(current 2026, plus 2025 and 2024) recovered 42 recorded game
summaries and **six** distinct verified rank/rate-similar defense games;
one also had a position-specific sample of three preceding games. This
used a hypothetical test-only line for analysis and did not query or
invent a real sportsbook quote. No diagnostic script or temporary
GitHub workflow step is retained on production.

As always, a **fresh live scan** is required to recalculate previously
saved old results, which are labeled LAST SAVED SCAN — NOT LIVE.
