/**
 * Licensed PrizePicks feed boundary. No guessed lines and no access to
 * undocumented/private PrizePicks endpoints. The operator must configure
 * an approved normalization service and explicitly attest permission.
 *
 * Cloudflare Pages secrets:
 *   PRIZEPICKS_FEED_ENDPOINT: HTTPS URL of authorized provider adapter
 *   PRIZEPICKS_FEED_TOKEN: provider credential (never sent to clients)
 *   PRIZEPICKS_FEED_APPROVED: "true" only after contract/permission review
 * Optional binding: PROJECTION_SNAPSHOTS (Cloudflare KV) for changes/removals.
 *
 * Version 1 upstream contract:
 * {source:"PrizePicks", fetchedAt:ISO, projections:[
 *   {id, sport, player, team, opponent, position, gameId, gameDateLocal,
 *    market, stat, line, variant:"standard"|"alternative",
 *    status:"active"|"suspended"|"removed", quotedAt:ISO,
 *    espnPlayerId?, espnTeamId?, espnOpponentId?}
 * ]}
 */
const SPORTS=new Set(["nfl","nba","ncaaf","ncaab","mlb","soccer"]);
const TYPES=new Set(["standard","alternative"]);
const STAT=/^[A-Za-z][A-Za-z0-9]{1,50}$/;
const respond=(payload,status=200)=>new Response(JSON.stringify(payload),{
  status,headers:{"content-type":"application/json; charset=utf-8",
    "cache-control":"no-store","x-content-type-options":"nosniff"}
});
const string=v=>typeof v==="string"?v.trim():"";
const validDate=d=>/^20\d\d-\d\d-\d\d$/.test(d)&&
  Number.isFinite(Date.parse(d+"T12:00:00Z")) &&
  new Date(d+"T12:00:00Z").toISOString().slice(0,10)===d;
const validInstant=v=>typeof v==="string"&&Number.isFinite(Date.parse(v));
const iso=v=>new Date(Date.parse(v)).toISOString();
const MAX_STALE_MS=30*60*1000;
function sanitize(p,sport,date,at){
  if(!p||typeof p!=="object"||
     string(p.sport)!==sport||string(p.gameDateLocal)!==date)return null;
  const id=string(p.id),player=string(p.player),team=string(p.team),
    opponent=string(p.opponent),position=string(p.position),
    gameId=string(p.gameId),market=string(p.market),stat=string(p.stat),
    variant=string(p.variant),status=string(p.status);
  if(!id||id.length>110||!player||!team||!opponent||!position||
    !gameId||!market||!STAT.test(stat)||!TYPES.has(variant)||
    !["active","suspended","removed"].includes(status)||
    typeof p.line!=="number"||!Number.isFinite(p.line)||p.line<0||
    !validInstant(p.quotedAt) || Date.parse(p.quotedAt)>at+120000 ||
    at-Date.parse(p.quotedAt)>MAX_STALE_MS)return null;
  return {id,player,team,opponent,position,gameId,gameDateLocal:date,
    sport,market,stat,line:p.line,variant,status,quotedAt:iso(p.quotedAt),
    espnPlayerId:string(p.espnPlayerId)||null,
    espnTeamId:string(p.espnTeamId)||null,
    espnOpponentId:string(p.espnOpponentId)||null,source:"PrizePicks"};
}
function compare(old,now){
  const before=new Map(old.map(p=>[p.id,p])),after=new Map(now.map(p=>[p.id,p]));
  const changes=[];
  for(const p of now){
    const prev=before.get(p.id);
    if(!prev)changes.push({id:p.id,kind:"added"});
    else if(prev.line!==p.line||prev.variant!==p.variant)
      changes.push({id:p.id,kind:"changed",from:prev.line,to:p.line});
    else if(prev.status!==p.status)
      changes.push({id:p.id,kind:p.status==="suspended"?"suspended":"status-changed"});
  }
  for(const p of old)if(!after.has(p.id))
    changes.push({id:p.id,kind:"removed"});
  return changes;
}
export async function onRequestGet({request,env={}}){
  const q=new URL(request.url).searchParams;
  const sport=string(q.get("sport")),date=string(q.get("date"));
  if(!SPORTS.has(sport)||!validDate(date))
    return respond({status:"invalid-request",error:"A valid sport and game date are required."},400);
  if(env.PRIZEPICKS_FEED_APPROVED!=="true" ||
     !string(env.PRIZEPICKS_FEED_TOKEN)||!string(env.PRIZEPICKS_FEED_ENDPOINT)){
    return respond({status:"integration-required",source:"PrizePicks",projections:[],
      changes:[],error:"Authorized PrizePicks line provider is not connected. Configure an approved data license, provider adapter, and credentials. No estimated lines will be shown."},503);
  }
  let endpoint;
  try{
    endpoint=new URL(env.PRIZEPICKS_FEED_ENDPOINT);
    if(endpoint.protocol!=="https:"||!endpoint.hostname||endpoint.username||
       endpoint.password||endpoint.hostname==="localhost"||
       endpoint.hostname.endsWith(".internal"))throw Error();
  }catch{
    return respond({status:"configuration-error",projections:[],
      error:"Approved feed endpoint must be a secure HTTPS provider URL."},503);
  }
  endpoint.searchParams.set("sport",sport);
  endpoint.searchParams.set("date",date);
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),10000);
  try{
    const response=await fetch(endpoint,{
      headers:{Authorization:"Bearer "+env.PRIZEPICKS_FEED_TOKEN,
        Accept:"application/json"},signal:controller.signal
    });
    if(!response.ok)return respond({status:"provider-unavailable",projections:[],
      error:"Authorized PrizePicks feed returned an error; no projections shown."},502);
    const body=await response.json(),now=Date.now();
    if(body?.source!=="PrizePicks"||!Array.isArray(body.projections)||
       !validInstant(body.fetchedAt)||Date.parse(body.fetchedAt)>now+120000||
       now-Date.parse(body.fetchedAt)>MAX_STALE_MS)
      return respond({status:"invalid-or-stale-feed",projections:[],
        error:"Provider data is unverified, stale, or does not match the required projection contract."},502);
    const validated=body.projections.map(p=>sanitize(p,sport,date,now)).filter(Boolean);
    if(validated.length!==body.projections.filter(p=>
      p?.sport===sport&&p?.gameDateLocal===date).length)
      return respond({status:"invalid-or-stale-feed",projections:[],
        error:"The feed includes invalid, ambiguous, or expired PrizePicks projections."},502);
    const ids=new Set();
    if(validated.some(p=>ids.has(p.id)||!ids.add(p.id)))
      return respond({status:"invalid-feed",projections:[],
        error:"Duplicate projection IDs were returned; no lines shown."},502);
    let changes=[],changeTracking="unavailable";
    const cache=env.PROJECTION_SNAPSHOTS;
    if(cache&&typeof cache.get==="function"&&typeof cache.put==="function"){
      try{
        const key="prizepicks:v1:"+sport+":"+date;
        const previous=JSON.parse(await cache.get(key)||"null");
        if(Array.isArray(previous)){
          changes=compare(previous,validated);changeTracking="verified";
        }else changeTracking="baseline-created";
        await cache.put(key,JSON.stringify(validated),{expirationTtl:86400*4});
      }catch{changeTracking="unavailable";}
    }
    return respond({status:"connected",source:"PrizePicks",sport,date,
      refreshedAt:new Date(now).toISOString(),sourceFetchedAt:iso(body.fetchedAt),
      changeTracking,changes,
      projections:validated.filter(p=>p.status==="active"),
      suspended:validated.filter(p=>p.status!=="active").map(p=>({id:p.id,status:p.status}))});
  }catch{
    return respond({status:"provider-unavailable",projections:[],
      error:"Authorized feed could not be verified or reached. No invented lines have been substituted."},502);
  }finally{clearTimeout(timer);}
}
