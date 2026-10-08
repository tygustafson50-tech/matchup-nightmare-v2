# Matchup Nightmare V2

A **six-sport, OVER-only matchup research website** built in a private GitHub repository and automatically deployed to Cloudflare Pages.

Sports: NFL, NBA, MLB, men's college football, men's college basketball, and men's soccer (EPL, La Liga, Bundesliga, Serie A, Ligue 1, MLS, Champions League).

Website: https://matchup-nightmare-v2.pages.dev

## Live workflow

1. Select a sport, date, and up to 16 games.
2. Click **Scan Selected Games**.
3. The backend retrieves completed game history and player box scores from provisional ESPN public endpoints where available.
4. View historical OVER research thresholds. **Similar-defense** and **recent-form** samples are distinct.
5. On each player card see the **Last 5 Games** and **Last 4 Matchups vs Similar Positional Defenses** with date, opponent, exact recorded stat, and OVER/BELOW/PUSH result.

All reported game statistics must come from actual parsed data. A missing stat is **not** zero.

## Position-specific defensive matching

We have replaced the old whole-team points-allowed proxy in automatic scans with an actual **stat- and position-group-specific defensive profile**.

- **NFL / College Football:** passing yards to QBs, receiving yards and receptions allowed to WRs/TEs/RBs separately, rushing stats allowed to RBs vs QBs.
- **NBA / College Basketball:** points/rebounds/assists/etc. conceded to **guards**, **forwards**, and **centers** (position groups, not individual defensive assignments).
- **Men's Soccer:** shots/shots on target/goals/etc. conceded to forwards, midfielders, defenders, or goalkeepers, only if positional statistics are available.
- **MLB:** an actual pitching-staff performance against batters or opposing batting-lineup strikeout tendency; baseball does not have a literal defender guarding a batter by position. Do not label it as such.

The backend looks at each defense's completed **pregame** opponent box scores and sums the selected market stat by role; it averages over **at least two** usable games. Comparable defenses must have the **same role and stat**, with an allowance within **25%** of the upcoming opponent's average. The most recent **up to four** qualifying historical opponent matchups are displayed; with fewer qualifying records, the actual count is shown instead of inventing games.

For budget control, each selected team's latest six completed games are gathered, and position profiles are attempted for its five most recent historical opposing defenses. Thus the comparison is a **limited historical search**, not a complete career-wide survey. If the provider lacks player position, a relevant stat, or enough pregame games, comparable position matchups are unavailable and **never silently replaced with whole-team scoring averages**.

Each similarity row also shows the **historical opponent's stat allowed to that position per game** and its sample size. These are group averages, not predictions or proof of direct one-on-one assignments.

## 100% historical thresholds — important

The scanner calculates candidate half-step OVER research thresholds using the minimum historical stat in the qualifying sample. This naturally can produce 100% **historical** rates by construction. It does **not** mean an 100% predicted probability, an advantage at bookmaker prices, or a wager guaranteed to win.

- **100% SIMILAR** = over threshold cleared in every qualifying comparable positional-defense game, with a minimum of 3 games.
- **100% RECENT** = over threshold cleared in every qualifying recent game, independently of defense. Recent-only cards still show positional-defense comparisons when available.

**No licensed live PrizePicks lines, other sportsbook lines, or alt-line markets are connected.** All calculated thresholds are labeled **research only**, not actual offered lines. They may not be purchasable at any sportsbook.

## Provider and hosting limitations

- Current ESPN API endpoints are public, unofficial, undocumented, and sometimes lack game logs, roster positions, or college/soccer player-level data. A failed or empty scan means insufficient data, **not** that no bets can win.
- Cloudflare Workers Free currently limits external subrequests per invocation. The scanning endpoint caps itself at 46 and can return incomplete positional comparisons if that budget is reached. No paid subscription is needed for the current starter.
- Injury context, coverage schemes, direct defender assignments, league-strength adjustments, pregame lineup forecasts, sportsbook data, full backtesting and calibrated probabilities are **not yet implemented**.
- Current source code is private on GitHub, but the Cloudflare website is publicly reachable unless you separately configure access controls.

## Hosting from GitHub

Connect the private repository to **Cloudflare Pages**, preset **None**, production branch **main**, build command **exit 0**, output directory **public**. Cloudflare Pages deploys commits automatically. No Node installation is required just to use the hosted website.

For local testing with Node.js 20+, run:

```sh
npm test
npm start
```

The website is served on http://localhost:3000 locally.

## Key files

- `functions/api/games.js` — upcoming schedules.
- `functions/api/scan.js` — selects completed histories; computes position-specific defense profiles under free-tier limits.
- `lib/auto-scan.js` — player stats, position mapping, defensive group aggregation, comparable-opponent filtering.
- `public/app.js` and `public/lib/game-history.js` — sport navigation, scan flow and visible history tables.
- `tests/auto-scan.test.js`, `tests/game-history.test.js` — calculations and UI regression checks.

Data coverage remains provisional until verified in production for each sport. Accuracy takes priority over showing a pick on every page.
