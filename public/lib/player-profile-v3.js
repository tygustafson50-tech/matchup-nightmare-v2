/**
 * ESPN roster-derived player photo, official fixture team logos, and injury
 * designation. Missing injuries are NEVER represented as "healthy".
 * The only permitted image sources are HTTPS ESPN CDN URLs.
 */
const esc=v=>String(v??"").replace(/[&<>"']/g,c=>({
  "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
}[c]));
const validDate=x=>typeof x==="string"&&Number.isFinite(Date.parse(x));
const abbr=s=>String(s||"").trim().split(/\s+/).map(x=>x[0]).filter(Boolean)
  .slice(0,2).join("").toUpperCase()||"?";
export function safeEspnImage(url){
  if(typeof url!=="string"||!url.trim())return null;
  try{
    const u=new URL(url);
    return u.protocol==="https:"&&
      ["a.espncdn.com","cdn.espn.com"].includes(u.hostname)&&
      !u.username&&!u.password?u.href:null;
  }catch{return null;}
}
const SPORT_HEADSHOT_PATH=Object.freeze({
  nfl:"nfl",ncaaf:"college-football",nba:"nba",
  ncaab:"mens-college-basketball",mlb:"mlb",soccer:"soccer"
});
export function verifiedHeadshot(sport,espnPlayerId,rosterUrl){
  const direct=safeEspnImage(rosterUrl);
  if(direct)return direct;
  // Use ID verified on the ESPN roster; no guessed/name-based portraits.
  const path=SPORT_HEADSHOT_PATH[sport];
  if(!path||!/^\d{1,15}$/.test(String(espnPlayerId||"")))return null;
  return "https://a.espncdn.com/i/headshots/"+path+
    "/players/full/"+String(espnPlayerId)+".png";
}
function classify(raw){
  const s=String(raw||"").trim().toLowerCase().replace(/[\s_-]+/g," ");
  if(!s)return null;
  if(/\b(injured reserve|injury reserve|ir|pup|physically unable|non football injury|nfi)\b/.test(s))
    return {label:"Injured reserve",kind:"out"};
  if(/\b(out for season|season ending|out)\b/.test(s))return {label:"Out",kind:"out"};
  if(/\bdoubtful\b/.test(s))return {label:"Doubtful",kind:"out"};
  if(/\bquestionable\b/.test(s))return {label:"Questionable",kind:"questionable"};
  if(/\b(probable)\b/.test(s))return {label:"Probable",kind:"questionable"};
  if(/\b(day to day|dtd|game time decision|gtd)\b/.test(s))
    return {label:"Day-to-day / game-time decision",kind:"questionable"};
  if(/\b(active|healthy|cleared|available|full participant|normal)\b/.test(s))
    return null;
  return {label:"Injury reported",kind:"reported"};
}
const short=s=>String(s||"").trim().slice(0,130);
function injuryDetails(entry){
  const a=entry?.details||{};
  return short([
    typeof a==="string"?a:
      a?.detail||a?.description||a?.type||a?.location||a?.name||"",
    entry?.description||entry?.shortComment||""
  ].filter(Boolean).join(" · "));
}
export function rosterInjuryStatus(athlete,checkedAt=new Date().toISOString()){
  const list=athlete?.injuries;
  const seen=validDate(checkedAt)?checkedAt:null;
  const base={source:"ESPN team roster",checkedAt:seen,detail:""};
  if(!Array.isArray(list))return {...base,label:"Status not confirmed",kind:"unknown"};
  if(!list.length)return {...base,label:"No injury listed",kind:"not-listed"};
  const candidates=list.map(entry=>{
    const raw=entry?.status?.type?.name||entry?.status?.type?.description||
      entry?.status?.name||entry?.status?.description||entry?.status||
      entry?.type?.name||entry?.type?.description||entry?.type||"";
    const parsed=classify(raw);
    return parsed?{...parsed,detail:injuryDetails(entry)}:null;
  }).filter(Boolean);
  if(!candidates.length)
    return {...base,label:"No active designation confirmed",kind:"unknown"};
  const priority={out:4,questionable:3,reported:2,unknown:1};
  candidates.sort((a,b)=>(priority[b.kind]||0)-(priority[a.kind]||0));
  return {...base,...candidates[0]};
}
export function extractRosterVisuals(athlete,{checkedAt=new Date().toISOString()}={}){
  const headshotUrl=safeEspnImage(
    typeof athlete?.headshot==="string"?athlete.headshot:
      athlete?.headshot?.href||athlete?.headshot?.url||null);
  return {headshotUrl,injury:rosterInjuryStatus(athlete,checkedAt)};
}
function slot(url,classname,fallback,alt){
  const src=safeEspnImage(url);
  return '<span class="'+classname+'">'+
    '<span class="brand-logo-fallback" aria-hidden="true">'+esc(fallback)+'</span>'+
    (src?'<img src="'+esc(src)+'" alt="'+esc(alt)+'" loading="lazy" decoding="async" data-fallback-image>':"")+
    '</span>';
}
function renderedTime(value){
  if(!validDate(value))return null;
  return new Intl.DateTimeFormat("en-US",{timeZone:"America/Chicago",
    month:"short",day:"numeric",hour:"numeric",minute:"2-digit",
    timeZoneName:"short"}).format(new Date(value));
}
export function renderPlayerCardHeader(card){
  const c=card||{},visuals=c.visuals||{},injury=visuals.injury||{};
  const archived=Boolean(c.cachedAt),positive=c.recommendation==="OVER";
  const headshot=verifiedHeadshot(c.sport,c.offer?.espnPlayerId,
    visuals.headshotUrl);
  const healthKind=["out","questionable","reported","not-listed","unknown"]
    .includes(injury.kind)?injury.kind:"unknown";
  const label=injury.label||"Status not confirmed";
  const injuryTime=renderedTime(injury.checkedAt);
  const playerPortrait='<span class="player-portrait">'+
    '<span class="player-initial" aria-hidden="true">'+esc(abbr(c.player))+'</span>'+
    (headshot?'<img class="player-image" src="'+esc(headshot)+'" alt="'+
      esc(c.player)+' headshot" loading="lazy" decoding="async" data-fallback-image>':"")+
    '</span>';
  const logos='<div class="matchup-logo-row">'+
    slot(visuals.teamLogo,"team-logo-slot",abbr(c.team),String(c.team||"Team")+" logo")+
    '<span class="matchup-team-name">'+esc(c.team)+' <span class="versus">vs</span> '+
      esc(c.opponent)+'</span>'+
    slot(visuals.opponentLogo,"team-logo-slot",abbr(c.opponent),
      String(c.opponent||"Opponent")+" logo")+'</div>';
  const healthDetails=injury.detail?
    '<span class="injury-detail">'+esc(injury.detail)+'</span>':"";
  const freshness=archived
    ?'Saved injury report — not rechecked'
    :injuryTime?'ESPN roster · checked '+esc(injuryTime):
      'ESPN roster · verification time unavailable';
  return '<div class="scan-top"><div class="scan-identity">'+
    playerPortrait+'<div class="player-identity-info">'+
    '<div class="player-name-row"><strong class="player-name">'+
       esc(c.player)+'</strong><span class="health-badge health-'+healthKind+
       '">'+(archived?'Saved: ':'')+esc(label)+'</span></div>'+
    logos+
    '<small class="player-meta">'+esc(c.position)+' · '+esc(c.book)+
       ' · '+esc(c.variant==="alternative"?"ALT":
         c.variant==="standard"?"Main":"Quoted")+'</small>'+
    '<span class="injury-provenance">'+freshness+healthDetails+'</span>'+
    '</div></div>'+
    '<span class="trend-badge'+((!positive||archived)?' trend-unverified':'')+'">'+
       (archived?"SAVED SCAN — NOT LIVE":positive?"OVER supported":
          "INSUFFICIENT / MIXED EVIDENCE")+'</span></div>';
}
