/**
 * GET /api/health
 * Minimal deployment diagnostic. Does not make external requests.
 * If this URL displays a website or HTML, Pages Functions routing is broken.
 */
export function onRequestGet(){
  return new Response(JSON.stringify({
    ok:true,service:"matchup-nightmare-v2",
    runtime:"cloudflare-pages-functions",
    apiRoutes:["/api/games","/api/espn","/api/scan","/api/career","/api/health"],
    recommendedSourceRoute:"/api/espn",
    historyAssembly:"browser-side for Cloudflare Free CPU compatibility",
    scanMode:"over-only",
    source:"server-side JSON route"
  }),{
    status:200,
    headers:{
      "content-type":"application/json; charset=utf-8",
      "cache-control":"no-store",
      "x-content-type-options":"nosniff"
    }
  });
}
