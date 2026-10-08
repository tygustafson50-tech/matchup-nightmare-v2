/**
 * A single ESPN resource per Cloudflare request.
 *
 * Historical aggregation and defensive comparisons run in the browser,
 * because Workers Free has a 10 ms CPU limit per invocation. This endpoint
 * streams one ESPN JSON document without parsing the whole boxscore on CF.
 * Never accepts an arbitrary URL or hostname.
 */
const SPORTS=Object.freeze({
  nfl:"football/nfl",nba:"basketball/nba",mlb:"baseball/mlb",
  ncaaf:"football/college-football",
  ncaab:"basketball/mens-college-basketball",
  soccer:"soccer/eng.1"
});
const SOCCER=new Set([
  "eng.1","esp.1","ger.1","ita.1","fra.1","usa.1","uefa.champions"
]);
const BASE="https://site.api.espn.com/apis/site/v2/sports/";
function json(data,status=502){
  return new Response(JSON.stringify(data),{
    status,headers:{
      "content-type":"application/json; charset=utf-8",
      "cache-control":"no-store",
      "x-content-type-options":"nosniff"
    }
  });
}
export async function onRequestGet({request}){
  const q=new URL(request.url).searchParams;
  const sport=q.get("sport")||"";
  const kind=q.get("kind")||"";
  const teamId=q.get("teamId")||"";
  const gameId=q.get("gameId")||"";
  const season=q.get("season")||"";
  const league=q.get("league")||"eng.1";
  const path=SPORTS[sport];
  if(!path)return json({error:"Unsupported sport."},400);
  if(sport==="soccer"&&!SOCCER.has(league))
    return json({error:"Unsupported soccer league."},400);
  const group=sport==="soccer"?"soccer/"+league:path;
  let route="";
  if(kind==="schedule"||kind==="roster"){
    if(!/^\d{1,9}$/.test(teamId)||!/^(19|20)\d{2}$/.test(season))
      return json({error:"Valid team and historical season are required."},400);
    route="/teams/"+teamId+"/"+kind+"?season="+season+
      (kind==="schedule"?"&limit=100":"");
  }else if(kind==="summary"){
    if(!/^\d{5,15}$/.test(gameId))
      return json({error:"Valid historical game ID is required."},400);
    route="/summary?event="+gameId;
  }else if(kind==="gamelog"){
    if(!/^\d{1,15}$/.test(q.get("playerId")||"")||
        !/^(19|20)\d{2}$/.test(season))
      return json({error:"Valid player ID and historical season are required."},400);
    route="/athletes/"+q.get("playerId")+"/gamelog?season="+season;
  }else{
    return json({error:"Unsupported ESPN resource type."},400);
  }
  const source=BASE+group+route;
  const controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(),9000);
  try{
    const upstream=await fetch(source,{
      signal:controller.signal,
      headers:{Accept:"application/json"}
    });
    if(!upstream.ok){
      return json({error:"ESPN "+kind+" source unavailable.",
        sourceStatus:upstream.status,
        details:"ESPN returned HTTP "+upstream.status+
          " for "+kind+"; the historical sample is incomplete."},502);
    }
    const type=upstream.headers.get("content-type")||"";
    if(!/json/i.test(type)){
      return json({error:"ESPN did not return a JSON document.",
        details:"Source "+kind+" returned "+(type||"unknown type")},502);
    }
    // Let the client parse and combine the document, not Workers Free CPU.
    return new Response(upstream.body,{
      status:200,
      headers:{
        "content-type":"application/json; charset=utf-8",
        "cache-control":kind==="summary"?"public, max-age=3600":
          kind==="roster"?"public, max-age=1800":"public, max-age=300",
        "x-content-type-options":"nosniff",
        "x-espn-resource":kind
      }
    });
  }catch(error){
    return json({error:"Unable to reach ESPN "+kind+" source.",
      details:String(error?.message||error).slice(0,150)},502);
  }finally{clearTimeout(timeout);}
}
