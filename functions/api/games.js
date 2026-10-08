/**
 * Cloudflare Pages Function: GET /api/games
 * Public scoreboard integration is unofficial and can become unavailable.
 * This endpoint NEVER serves betting markets, fabricated stats, or projections.
 */
const sports = {
  nfl: ["football", "nfl"],
  nba: ["basketball", "nba"],
  mlb: ["baseball", "mlb"],
  ncaaf: ["football", "college-football"],
  ncaab: ["basketball", "mens-college-basketball"],
  soccer: ["soccer", "eng.1"]
};
const soccerLeagues = new Set([
  "eng.1", "esp.1", "ger.1", "ita.1", "fra.1", "usa.1", "uefa.champions"
]);

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": status === 200 ? "public, max-age=60" : "no-store",
      "X-Content-Type-Options": "nosniff"
    }
  });
}

export async function onRequestGet({ request }) {
  const url = new URL(request.url);
  const sport = url.searchParams.get("sport") || "nfl";
  const date = url.searchParams.get("date") || new Date().toISOString().slice(0, 10);

  if (!Object.hasOwn(sports, sport)) return json({ error: "Unsupported sport" }, 400);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return json({ error: "Invalid date" }, 400);
  }
  // Reject impossible dates that JavaScript would otherwise normalize.
  const dateObj = new Date(date + "T00:00:00Z");
  if (Number.isNaN(dateObj.getTime()) ||
      dateObj.toISOString().slice(0, 10) !== date) {
    return json({ error: "Invalid date" }, 400);
  }

  const league = sport === "soccer"
    ? url.searchParams.get("league") || "eng.1"
    : sports[sport][1];
  if (sport === "soccer" && !soccerLeagues.has(league)) {
    return json({ error: "Unsupported soccer league" }, 400);
  }

  const params = new URLSearchParams({ dates: date.replaceAll("-", ""), limit: "100" });
  const endpoint = "https://site.api.espn.com/apis/site/v2/sports/" +
    sports[sport][0] + "/" + league + "/scoreboard?" + params;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 9000);
    let upstream;
    try {
      upstream = await fetch(endpoint, {
        signal: controller.signal,
        headers: { Accept: "application/json" }
      });
    } finally {
      clearTimeout(timeout);
    }
    if (!upstream.ok) throw new Error("Scoreboard provider returned HTTP " + upstream.status);
    const payload = await upstream.json();
    const games = (payload.events || []).map(event => {
      const entries = event.competitions?.[0]?.competitors || [];
      const home = entries.find(item => item.homeAway === "home");
      const away = entries.find(item => item.homeAway === "away");
      if (!home || !away) return null;
      return {
        id: String(event.id),
        date: event.date,
        season: Number.isInteger(Number(event.season?.year))
          ? Number(event.season.year) : null,
        status: event.status?.type?.description || "Scheduled",
        home: {
          id:String(home.team?.id || ""),
          name: home.team?.displayName || "Home",
          logo: home.team?.logo || ""
        },
        away: {
          id:String(away.team?.id || ""),
          name: away.team?.displayName || "Away",
          logo: away.team?.logo || ""
        }
      };
    }).filter(Boolean);
    return json({
      sport, date, league, games,
      source: "ESPN public scoreboard (unofficial; not betting data)",
      fetchedAt: new Date().toISOString(),
      oddsConnected: false
    });
  } catch (error) {
    return json({
      error: "Schedules temporarily unavailable",
      details: String(error.message).slice(0, 120)
    }, 502);
  }
}
