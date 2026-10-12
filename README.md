# Matchup Nightmare V3

**Evidence-first, OVER-only player-prop research.** Preserves the V2 black-and-gold UI, six sport tabs, game selection, player cards, and Cloudflare Pages hosting. The old line generator, manual predictions, snap-based automatic picks, five-plus-four forced-hits filter, and legacy matchup scanner are retired.

**Primary evidence flow:** verified, authorized **PrizePicks** projection -> five current-season player games -> up to three seasons of player game results against independently verified **position- and stat-specific comparable defenses** -> accurate history and optional OVER research recommendation.

## Integration status / important blocker

PrizePicks does **not** currently publish an open, licensed public developer API for arbitrary third-party apps. V3 intentionally does NOT scrape unofficial PrizePicks private endpoints or invent alternative lines. There is **no real PrizePicks integration until the owner obtains and configures a licensed/approved provider**. A fully configured adapter is required for any prop card to appear.

The Cloudflare Pages Function `/api/lines?sport=nfl&date=YYYY-MM-DD` accepts **only** an operator-authorized, explicitly configured HTTPS feed. In Cloudflare Pages, configure:

- Secret `PRIZEPICKS_FEED_ENDPOINT`: HTTPS endpoint of a provider adapter licensed to deliver exactly sourced PrizePicks lines.
- Secret `PRIZEPICKS_FEED_TOKEN`: credential for that adapter, never exposed to a browser.
- Variable `PRIZEPICKS_FEED_APPROVED=true`: set only after verifying the feed contract, permitted use, and public display rights.
- Optional Cloudflare KV binding `PROJECTION_SNAPSHOTS`: tracks changed, added, removed or suspended provider projections between refreshes. Without KV it says **tracking unavailable**.

**The endpoint alone is not a contract, key, or active integration.** A provider must be contracted and its data shaped into the adapter contract. Do not enter dummy secrets in production to bypass validation. Current state with no feed is expected to show **Integration Required** and no picks.

### Provider adapter payload (version 1)

A verified upstream service must return:

```json
{
  "source": "PrizePicks",
  "fetchedAt": "2026-10-11T18:40:00Z",
  "projections": [
    {
      "id": "provider-projection-id",
      "sport": "nfl",
      "player": "A real licensed PrizePicks player",
      "team": "Source-verified current team",
      "opponent": "Source-verified current opponent",
      "position": "WR",
      "gameId": "ESPN event ID if mapped",
      "gameDateLocal": "2026-10-11",
      "market": "Receiving yards",
      "stat": "receivingYards",
      "line": 49.5,
      "variant": "standard",
      "status": "active",
      "quotedAt": "2026-10-11T18:38:00Z",
      "espnPlayerId": "Verified matching ESPN athlete ID",
      "espnTeamId": "Verified matching ESPN team ID",
      "espnOpponentId": "Verified matching opponent ID"
    }
  ]
}
```

The example is a **schema illustration only, NOT a real player or actual feed response**. `variant` must be `standard` or `alternative`; `status` must be `active`, `suspended`, or `removed`. All three required timestamps and current projection values must come from the licensed source. Invalid or stale source/projection documents (older than 30 minutes) fail closed. Line changes/suspensions are only described as **tracked** when KV has previous verified snapshots.

## Statistical evidence

V3 retrieves game schedules from the public ESPN scoreboard and attempts to reconcile the PrizePicks player against the ESPN team's official roster. It fetches player game-log event references and completed box scores for **the selected sport season plus the previous two seasons**, retaining actual opponent, date, recorded stat and identity. Missing/unsupported box scores never become zeros.

Each past opposing defense is evaluated using **only games completed before** the applicable player matchup. A position-specific average of the selected stat AND relevant usage volume is required (at least three valid pregame box scores). The upcoming defense is measured in the same fashion.

Defensive matching is season-normalized using documented, measured cohorts of at least five distinct opponent teams **within each season and sport/position/stat combination**. The comparison is a standardized two-feature distance, with a transparent threshold 0.80. These are **sampled same-season cohorts, not full league rankings**, because complete licensed league-wide defensive profiles are not connected. Until sample cohorts and exact identity/position/usage can be verified, comparable history is explicitly **insufficient**; it will not be fabricated or replaced with random opponents.

Soccer requires the same verified competition. MLB batter comparisons additionally require verified opposing starting-pitcher handedness; without this optional external feed, baseball batters usually lack comparable history. Some ESPN position, usage, and game-log fields are incomplete or unofficial, so many valid PrizePicks offers can appear with recent-game evidence but no confident comparable defense match.

**Current-season recent evidence** = last five verified player games. **Three-season matchup evidence** = every verified actual past game against opponents meeting the sport-specific, season-normalized comparison, not an arbitrary four-game cap. Both independently compare exact recorded outcomes to today's selected **verified** PrizePicks line, never alleged historical betting lines.

A card can say `OVER` only with at least three recent and three comparable verified results AND a historical OVER majority in both independent samples; otherwise it says insufficient/mixed evidence. This is transparent evidence ranking, **not a calibrated predictive probability or guarantee**.

## Verify and deploy

`npm test` runs the new V3 source-integrity, line authentication, cross-sport model and defensive evidence tests. Cloudflare Pages automatically builds `main` after merging a reviewed PR. Verify the deployed `/api/lines` returns `503 integration-required` until genuine authorized credentials have been configured. Confirm the exact source quote timestamp and projection identity from the contracted partner before enabling user-facing recommendations.

No code in V3 claims live PrizePicks availability, 100% success, or a finished licensed data hookup unless each assertion is backed by the source itself.
