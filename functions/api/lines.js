/**
 * PropLine REST API v1. Source of displayed player prop lines: actual OVER
 * outcomes quoted by identifiable sportsbooks, never simulated thresholds.
 * Requires Cloudflare Pages secret PROPLINE_API_KEY.
 * https://prop-line.com/docs
 */
const CHOICES={
  nfl:["football_nfl","americanfootball_nfl"],
  nba:["basketball_nba"],
  mlb:["baseball_mlb"],
  ncaaf:["football_ncaaf","americanfootball_ncaaf"],
  ncaab:["basketball_ncaab","basketball_ncaab_men"],
  soccer:["soccer_epl"]
};
const SOCCER={
  "eng.1":{keys:["soccer_epl"],name:"Premier League"},
  "esp.1":{keys:["soccer_spain_la_liga"],name:"La Liga"},
  "ger.1":{keys:["soccer_germany_bundesliga"],name:"Bundesliga"},
  "ita.1":{keys:["soccer_italy_serie_a"],name:"Serie A"},
  "fra.1":{keys:["soccer_france_ligue_one","soccer_france_ligue_1"],name:"Ligue 1"},
  "usa.1":{keys:["soccer_usa_mls"],name:"MLS"},
  "uefa.champions":{keys:["soccer_uefa_champs_league"],name:"Champions League"}
};
const MARKETS={
  nfl:["player_pass_yds","player_pass_completions","player_pass_attempts","player_pass_tds",
    "player_rush_yds","player_rush_attempts","player_rush_tds",
    "player_receptions","player_reception_yds","player_reception_tds"],
  ncaaf:["player_pass_yds","player_pass_completions","player_pass_attempts","player_pass_tds",
    "player_rush_yds","player_rush_attempts","player_rush_tds",
    "player_receptions","player_reception_yds","player_reception_tds"],
  nba:["player_points","player_rebounds","player_assists","player_threes",
    "player_points_rebounds_assists","player_steals","player_blocks"],
  ncaab:["player_points","player_rebounds","player_assists","player_threes",
    "player_points_rebounds_assists","player_steals","player_blocks"],
  mlb:["pitcher_strikeouts","pitcher_outs","batter_hits","batter_home_runs",
    "batter_total_bases","batter_runs","batter_rbis","batter_walks",
    "batter_1plus_hits","batter_2plus_hits","batter_3plus_hits","batter_4plus_hits",
    "batter_2plus_home_runs","batter_1plus_rbis","batter_2plus_rbis","batter_3plus_rbis"],
  soccer:["player_assists","player_2plus_assists","player_tackles",
    "anytime_goal_scorer","2plus_goals"]
};
const MARKET_MAP={
  player_pass_yds:["passingYards","Passing yards"],
  player_pass_completions:["passCompletions","Pass completions"],
  player_pass_attempts:["passAttempts","Pass attempts"],
  player_pass_tds:["passingTDs","Passing touchdowns"],
  player_rush_yds:["rushingYards","Rushing yards"],
  player_rush_attempts:["rushAttempts","Rush attempts"],
  player_rush_tds:["rushingTDs","Rushing touchdowns"],
  player_receptions:["receptions","Receptions"],
  player_reception_yds:["receivingYards","Receiving yards"],
  player_reception_tds:["receivingTDs","Receiving touchdowns"],
  player_points:["points","Points"],player_rebounds:["rebounds","Rebounds"],
  player_assists:["assists","Assists"],player_threes:["threes","3-pointers"],
  player_points_rebounds_assists:["pra","PRA"],
  player_steals:["steals","Steals"],player_blocks:["blocks","Blocks"],
  pitcher_strikeouts:["pitcherKs","Pitcher strikeouts"],
  pitcher_outs:["pitchingOuts","Pitching outs"],
  batter_hits:["hits","Hits"],batter_home_runs:["homeRuns","Home runs"],
  batter_total_bases:["totalBases","Total bases"],
  batter_runs:["runs","Runs"],batter_rbis:["rbis","RBIs"],
  batter_walks:["walks","Walks"],
  player_tackles:["tackles","Tackles"],
  player_2plus_assists:["assists","Assists"],
  anytime_goal_scorer:["goals","Goals"],"2plus_goals":["goals","Goals"],
  batter_1plus_hits:["hits","Hits"],batter_2plus_hits:["hits","Hits"],
  batter_3plus_hits:["hits","Hits"],batter_4plus_hits:["hits","Hits"],
  batter_2plus_home_runs:["homeRuns","Home runs"],
  batter_1plus_rbis:["rbis","RBIs"],batter_2plus_rbis:["rbis","RBIs"],
  batter_3plus_rbis:["rbis","RBIs"]
};
// N+ price comes directly from the sportsbook. For an integer count,
// recorded >= N is mathematically equivalent to Over (N - 0.5).
const MINIMUM_MARKET={
  "2plus_goals":2,player_2plus_assists:2,
  batter_1plus_hits:1,batter_2plus_hits:2,batter_3plus_hits:3,
  batter_4plus_hits:4,batter_2plus_home_runs:2,
  batter_1plus_rbis:1,batter_2plus_rbis:2,batter_3plus_rbis:3
};
const YES_ONLY_MARKETS=new Set([
  "batter_home_runs","batter_runs","batter_rbis","batter_hits",
  "batter_total_bases","batter_walks",
  "anytime_goal_scorer","player_assists","player_2plus_assists",
  "player_tackles","2plus_goals",...Object.keys(MINIMUM_MARKET)
]);
// PropLine documents an unfiltered per-event prop request. Keep every
// identifiable book returned by the connected provider, not just a whitelist
// that excludes new or previously unsupported books.
const validBook=key=>typeof key==="string"&&/^[a-z][a-z0-9_]{2,39}$/.test(key);
// Pick'em legs are actual posted thresholds but their +100 is not an
// individual sportsbook price. Preserve the threshold, hide synthetic odds.
const DFS_SYNTHETIC_PRICE=new Set([
  "prizepicks","underdog","sleeper","dabble","parlayplay"
]);
// Only validated selected ESPN fixtures may trigger paid API calls.
const teamNorm=x=>String(x||"").normalize("NFKD").toLowerCase()
  .replace(/[\u0300-\u036f]/g,"").replace(/\bsaint\b/g,"st")
  .replace(/\bstate\b/g,"st")
  .replace(/\bman\b/g,"manchester").replace(/\butd\b/g,"united")
  .replace(/\bde\b/g,"").replace(/\bfc\b|\bcf\b/g,"")
  .replace(/\bthe\b/g,"").replace(/[^a-z0-9]/g,"");
function readFixtureFilter(raw){
  if(!raw)return {fixtures:[{all:true}]};
  if(raw.length>4500)return {error:"Selected fixtures query is too large."};
  try{
    const items=JSON.parse(raw);
    if(!Array.isArray(items)||items.length>16||!items.length)
      return {error:"Select between one and sixteen verified ESPN fixtures."};
    const fixtures=items.map(f=>({
      id:String(f?.id||""),home:String(f?.home||"").trim(),
      away:String(f?.away||"").trim()
    }));
    if(fixtures.some(f=>!/^\d{5,15}$/.test(f.id)||
      !f.home||!f.away||f.home.length>110||f.away.length>110))
      return {error:"Invalid ESPN game fixture selection."};
    return {fixtures};
  }catch{return {error:"Invalid selected fixture data."};}
}
function sameTeam(a,b,sport){
  const x=teamNorm(a),y=teamNorm(b);
  if(!x||!y)return false;
  if(x===y||x.length>=8&&y.length>=8&&
    (x.endsWith(y)||y.endsWith(x)||
      x.length>=10&&y.length>=10&&(x.startsWith(y)||y.startsWith(x))))
    return true;
  // Professional US teams have unique mascot names *within the sport*.
  // ESPN may say "LA Lakers", DraftKings "Los Angeles Lakers".
  if(["nfl","nba","mlb"].includes(sport)){
    const last=x=>String(x||"").toLowerCase().trim()
      .split(/[^a-z0-9]+/).filter(Boolean).at(-1)||"";
    const m=last(a),n=last(b);
    return m.length>=4&&m===n;
  }
  // No mascot-only matching for NCAA: many Tigers and Bulldogs.
  return false;
}
function matchesRequestedEvent(event,fixture,sport){
  if(fixture.all)return true; // Compatibility with old direct API clients.
  if(event.espn_event_id&&String(event.espn_event_id)===fixture.id)return true;
  return sameTeam(event.home_team,fixture.home,sport)&&
    sameTeam(event.away_team,fixture.away,sport);
}

// Intentionally omit DFS, exchanges, prediction markets and synthetic pick-'em pricing.
const reply=(data,status=200)=>new Response(JSON.stringify(data),{
  status,headers:{"content-type":"application/json; charset=utf-8",
    "cache-control":"no-store","x-content-type-options":"nosniff"}
});
const str=x=>typeof x==="string"?x.trim():"";
const validDate=d=>/^20\d\d-\d\d-\d\d$/.test(d)&&
  !Number.isNaN(Date.parse(d+"T12:00:00Z")) &&
  new Date(d+"T12:00:00Z").toISOString().slice(0,10)===d;
const dateCentral=iso=>{
  const parts=new Intl.DateTimeFormat("en-US",{
    timeZone:"America/Chicago",year:"numeric",month:"2-digit",day:"2-digit"
  }).formatToParts(new Date(iso));
  const get=type=>parts.find(p=>p.type===type)?.value||"";
  return get("year")+"-"+get("month")+"-"+get("day");
};
// The timestamp is the book's last delivery, not merely its last price change.
// Permit slower pregame market refreshes, never old or suspended selections.
const timeOk=(value,now)=>typeof value==="string"&&Number.isFinite(Date.parse(value))&&
  Date.parse(value)<=now+120000&&now-Date.parse(value)<=90*60*1000;
function quotedSelection(outcome,market,sport){
  const name=str(outcome?.name),word=name.toLowerCase(),point=outcome?.point;
  if(Number.isFinite(point)&&point>=0&&["over","yes"].includes(word))
    return {line:point,shape:"over-under",selectionLabel:null,minimumStat:null};
  if(!YES_ONLY_MARKETS.has(market.key)||!MARKETS[sport].includes(market.key)||
    point!==null&&point!==undefined)return null;
  if(["no","under"].includes(word))return null;
  const rung=/^(\d{1,3})\s*\+/.exec(name);
  const minimum=rung?Number(rung[1]):MINIMUM_MARKET[market.key]||1;
  if(!rung&&word!=="yes"&&teamNorm(name)!==teamNorm(outcome.description))
    return null;
  if(!Number.isInteger(minimum)||minimum<1||minimum>100)return null;
  return {line:minimum-0.5,shape:"milestone",
    selectionLabel:rung?name:minimum+"+ "+MARKET_MAP[market.key][1],
    minimumStat:minimum};
}
function selectionStillOffered(outcome,market){
  // A quote missing from the book's latest delivery is not offered now.
  if(!outcome.last_seen_at)return true;
  const seen=Date.parse(outcome.last_seen_at),delivered=Date.parse(market.last_update);
  return Number.isFinite(seen)&&Number.isFinite(delivered)&&
    seen>=delivered-120000;
}
const linesFrom=(event,{sport,date,now,diagnostics=null}={})=>{
  if(!event||!event.id||!Array.isArray(event.bookmakers)||
    !Number.isFinite(Date.parse(event.commence_time))||
    dateCentral(event.commence_time)!==date||!str(event.home_team)||!str(event.away_team))
    return [];
  const offers=[],seen=new Set();
  for(const bookmaker of event.bookmakers){
    if(!validBook(bookmaker?.key)||bookmaker?.pregame_only===true &&
      Date.parse(event.commence_time)<=now)continue;
    if(diagnostics)diagnostics.bookmakerBoards++;
    for(const market of bookmaker.markets||[]){
      if(!MARKET_MAP[market?.key]||!MARKETS[sport].includes(market.key))continue;
      if(diagnostics)diagnostics.supportedMarkets++;
      if(market.suspended_at||!timeOk(market.last_update,now))continue;
      if(diagnostics)diagnostics.freshMarkets++;
      for(const outcome of market.outcomes||[]){
        if(diagnostics)diagnostics.selectionsConsidered++;
        if(!str(outcome?.description)||!Number.isFinite(outcome?.price)||
          outcome.price===0||!selectionStillOffered(outcome,market))continue;
        const selection=quotedSelection(outcome,market,sport);
        if(!selection)continue;
        const [stat,display]=MARKET_MAP[market.key];
        const player=str(outcome.description).replace(/\s+\([A-Z]{2,4}\)$/,"").trim();
        const qualifiedPlayer=String(outcome.player_id||"");
        const espnPlayerId=/^espn:(\d{1,15})$/.exec(qualifiedPlayer)?.[1]||null;
        const sourceId=String(outcome.outcome_id||outcome.book_outcome_id||"");
        const id=[bookmaker.key,event.id,market.key,
          sourceId||player.toLowerCase().replace(/[^a-z0-9]/g,""),selection.line].join("|");
        if(seen.has(id))continue;seen.add(id);
        const rawType=String(outcome.line_type||market.line_type||"").toLowerCase();
        const variant=rawType==="main"?"standard":
          rawType==="alternate"||rawType==="milestone"?"alternative":"unclassified";
        if(diagnostics)diagnostics.verifiedSelections++;
        offers.push({
          id,source:"PropLine",book:bookmaker.title||bookmaker.key,
          bookKey:bookmaker.key,player,team:null,opponent:null,position:null,
          sport,gameId:str(event.espn_event_id)||null,
          providerEventId:String(event.id),gameDateLocal:date,
          fixture:{home:event.home_team,away:event.away_team},
          market:display,stat,line:selection.line,
          quoteShape:selection.shape,selectionLabel:selection.selectionLabel,
          minimumStat:selection.minimumStat,
          variant,status:"active",quotedAt:market.last_update,
          price:DFS_SYNTHETIC_PRICE.has(bookmaker.key)?null:outcome.price,
          priceIsSynthetic:DFS_SYNTHETIC_PRICE.has(bookmaker.key),
          espnPlayerId,providerPlayerId:qualifiedPlayer||null,
          espnTeamId:null,espnOpponentId:null
        });
      }
    }
  }
  return offers;
};
export function normalizePropLineOdds(payload,options){
  const rows=Array.isArray(payload)?payload:
    payload?.id&&Array.isArray(payload.bookmakers)?[payload]:null;
  if(!rows)throw Error("PropLine odds response was not a valid event list.");
  return rows.flatMap(event=>linesFrom(event,options));
}
function compare(previous,current){
  const a=new Map(previous.map(p=>[p.id,p]));
  const b=new Map(current.map(p=>[p.id,p]));
  const changes=[];
  for(const [id,p] of b){
    const old=a.get(id);
    if(!old)changes.push({id,kind:"added"});
    else if(old.line!==p.line||old.price!==p.price||old.quotedAt!==p.quotedAt)
      changes.push({id,kind:"updated",line:p.line});
  }
  for(const [id] of a)if(!b.has(id))changes.push({id,kind:"removed-or-suspended"});
  return changes;
}
async function api(path,key,query=null){
  const url=new URL("https://api.prop-line.com/v1/"+path);
  if(query)for(const [k,v] of Object.entries(query))url.searchParams.set(k,String(v));
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),11000);
  try{
    const response=await fetch(url,{
      headers:{"X-API-Key":key,Accept:"application/json"},
      signal:controller.signal
    });
    if(!response.ok){
      const e=new Error("PropLine responded with HTTP "+response.status);
      e.status=response.status;e.retryAfter=response.headers.get("Retry-After");
      throw e;
    }
    return {body:await response.json(),quota:response.headers.get("X-Daily-Remaining")};
  }finally{clearTimeout(timer);}
}
export async function onRequestGet({request,env={}}){
  const q=new URL(request.url).searchParams;
  const sport=str(q.get("sport")),date=str(q.get("date")),league=str(q.get("league"))||"eng.1";
  if(!CHOICES[sport]||!validDate(date)||
     sport==="soccer"&&!SOCCER[league])
    return reply({status:"invalid-request",error:"Valid sport, league and date required."},400);
    const requested=readFixtureFilter(q.get("fixtures"));
    if(requested.error)
      return reply({status:"invalid-request",error:requested.error},400);
  if(!str(env.PROPLINE_API_KEY))
    return reply({status:"integration-required",source:"PropLine",projections:[],
      error:"PropLine API key not connected. Get a free key at prop-line.com and add PROPLINE_API_KEY as a Cloudflare Pages secret."},503);
  try{
    const discovered=await api("sports",env.PROPLINE_API_KEY);
    if(!Array.isArray(discovered.body))throw Error("PropLine sports catalog unavailable.");
    const sportList=discovered.body.filter(x=>str(x.key));
    const target=sport==="soccer"?SOCCER[league].keys:CHOICES[sport];
    const exact=sportList.find(x=>target.includes(x.key));
    const desiredTitle=sport==="soccer"?SOCCER[league].name:null;
    const byName=desiredTitle?sportList.find(x=>
      String(x.title||"").toLowerCase()===desiredTitle.toLowerCase()):null;
    const matched=exact||byName;
    if(!matched)
      return reply({status:"sport-unavailable",projections:[],source:"PropLine",
        error:"PropLine did not list a verified market for this selected sport/league."},424);
    const now=Date.now();
    // Bulk /odds documents GAME LINES. The real per-player markets live in
    // /events/{event_id}/odds. Fetch only today's selected fixtures so a free
    // API key is not drained by an entire college-football slate.
    const eventList=await api("sports/"+encodeURIComponent(matched.key)+"/events",
      env.PROPLINE_API_KEY);
    if(!Array.isArray(eventList.body))
      throw Error("PropLine did not return a verified event list.");
    const today=eventList.body.filter(e=>e?.id&&
      Number.isFinite(Date.parse(e.commence_time))&&
      dateCentral(e.commence_time)===date&&
      requested.fixtures.some(f=>matchesRequestedEvent(e,f,sport)));
    const MAX_EVENTS=16;
    const candidates=today.slice(0,MAX_EVENTS);
    const eventOdds=await Promise.allSettled(candidates.map(e=>
      api("sports/"+encodeURIComponent(matched.key)+"/events/"+
        encodeURIComponent(String(e.id))+"/odds",env.PROPLINE_API_KEY,{
          markets:MARKETS[sport].join(","),
          includeBookIds:"true"
        })));
    let quota=eventList.quota;
    const eventFailures=[];
    let successfulEventResponses=0;
    const projections=[];
    const diagnostics={bookmakerBoards:0,supportedMarkets:0,
      freshMarkets:0,selectionsConsidered:0,verifiedSelections:0};
    for(let i=0;i<eventOdds.length;i++){
      const got=eventOdds[i],listed=candidates[i];
      if(got.status!=="fulfilled"){
        eventFailures.push(String(listed.id)+": "+
          String(got.reason?.message||"provider unavailable").slice(0,90));
        continue;
      }
      successfulEventResponses++;
      if(got.value.quota!=null)quota=got.value.quota;
      // Event odds response can omit fixture metadata. Only inject fields
      // from the verified /events source (never source our own point/price).
      const original=got.value.body;
      const priceRows=Array.isArray(original)?original:[original];
      for(const priced of priceRows){
        if(!priced||typeof priced!=="object")continue;
        const verified={...listed,...priced,id:priced.id||listed.id,
          commence_time:priced.commence_time||listed.commence_time,
          home_team:priced.home_team||listed.home_team,
          away_team:priced.away_team||listed.away_team};
        try{
          projections.push(...normalizePropLineOdds([verified],{sport,date,now,diagnostics}));
        }catch{eventFailures.push(String(listed.id)+": malformed odds response");}
      }
    }
    if(eventFailures.some(msg=>/HTTP 429/.test(msg))&&!projections.length)
      return reply({status:"rate-limited",source:"PropLine",
        projections:[],error:"PropLine quota reached while loading selected game props."},429);
    // A failed feed is not evidence that no book has posted props.
    if(candidates.length>0&&successfulEventResponses===0)
      return reply({status:"provider-unavailable",source:"PropLine",
        projections:[],eventsChecked:candidates.length,
        eventsFailed:eventFailures.length,
        error:"All selected event-odds requests failed. The provider's prop availability is unknown; please retry.",
        providerWarnings:eventFailures.slice(0,8)},502);
    const fetchedEvents=candidates.length;
    let changes=[],changeTracking="unavailable";
    if(env.PROJECTION_SNAPSHOTS&&
       typeof env.PROJECTION_SNAPSHOTS.get==="function"&&
       typeof env.PROJECTION_SNAPSHOTS.put==="function"){
      try{
        // A scan for different games must not mark unqueried quotes removed.
        const fixtureScope=requested.fixtures.map(f=>f.all?"all":f.id)
          .sort().join(",");
        const key="propline:v2:"+matched.key+":"+date+":"+fixtureScope;
        const prior=JSON.parse(await env.PROJECTION_SNAPSHOTS.get(key)||"null");
        if(Array.isArray(prior)){changes=compare(prior,projections);changeTracking="verified";}
        else changeTracking="baseline-created";
        await env.PROJECTION_SNAPSHOTS.put(key,JSON.stringify(projections),{expirationTtl:345600});
      }catch{changeTracking="unavailable";}
    }
    return reply({status:"connected",source:"PropLine",sportsbook:"Multiple verified sources",sport,sportKey:matched.key,
      date,sourceFetchedAt:new Date(now).toISOString(),refreshedAt:new Date(now).toISOString(),
      projections,changes,changeTracking,
      eventsFound:today.length,eventsChecked:fetchedEvents,
      eventsFailed:eventFailures.length,providerWarnings:eventFailures.slice(0,8),diagnostics,
      dailyRequestsRemaining:quota!==null&&Number.isFinite(Number(quota))?Number(quota):null,
      notes:[
        ...(today.length>MAX_EVENTS?["Only the first "+MAX_EVENTS+
          " events were checked to limit API usage; select fewer fixtures."]:[]),
        ...(eventFailures.length?[
          eventFailures.length+" selected event prop request(s) were unavailable."]:[]),
        ...(!projections.length?[
          today.length===0?"No selected events were found by PropLine for that date.":
          diagnostics.bookmakerBoards===0?
            "None of the connected prop providers have a player-prop board for these events.":
          diagnostics.supportedMarkets===0?
            "Connected providers have no supported player-stat markets for these games.":
          diagnostics.freshMarkets===0?
            "Available player markets are suspended or too old to verify.":
            "No eligible active OVER or equivalent YES/milestone selections are listed across connected providers."]:[]
        )
      ]});
  }catch(error){
    const limited=error.status===429,unauthorized=error.status===401||error.status===403;
    return reply({status:limited?"rate-limited":unauthorized?"key-invalid":"provider-unavailable",
      source:"PropLine",projections:[],error:limited
        ?"PropLine quota or burst limit reached; retry after provider reset."
        :unauthorized?"PropLine rejected the configured API key."
        :"Could not obtain verified PropLine market data ("+String(error.message).slice(0,140)+")."},
      limited?429:unauthorized?502:502);
  }
}
