/**
 * MATCHUP NIGHTMARE V3 — no legacy model.
 * The only entry point for automatic recommendations is a freshly verified
 * verified PropLine sportsbook quote followed by verified game-by-game evidence.
 */
import {analyzeVerifiedProp,rankEvidence} from "/lib/research-v3.js";
import {makeEvidenceClient,loadVerifiedEvidence} from "/lib/evidence-client-v3.js";
const SPORTS={
  nfl:"🏈 NFL",nba:"🏀 NBA",mlb:"⚾ MLB",
  ncaaf:"🏈 College Football",ncaab:"🏀 College Basketball",
  soccer:"⚽ Men's Soccer"
};
const LEAGUES={"eng.1":"Premier League","esp.1":"La Liga",
  "ger.1":"Bundesliga","ita.1":"Serie A","fra.1":"Ligue 1",
  "usa.1":"MLS","uefa.champions":"Champions League"};
const el=id=>document.getElementById(id);
const safe=v=>String(v??"").replace(/[&<>"']/g,c=>({
  "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
}[c]));
const prettyDate=s=>{try{return new Intl.DateTimeFormat("en-US",{
  dateStyle:"medium",timeZone:"America/Chicago"}).format(new Date(s));}
  catch{return String(s||"Unknown date");}};
const kickoff=s=>{try{return new Intl.DateTimeFormat("en-US",{
  timeZone:"America/Chicago",month:"short",day:"numeric",hour:"numeric",
  minute:"2-digit",timeZoneName:"short"}).format(new Date(s));}
  catch{return "Kickoff unavailable";}};
const normalize=s=>String(s||"").normalize("NFKD")
  .replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]/g,"");
let sport="nfl",games=[],selected=new Set(),cards=[],scanId=0,visibleLimit=24;
let watchedQuotes=null,watchBusy=false;
function status(message){el("scanProgress").textContent=message;}
function clearResults(){
  cards=[];watchedQuotes=null;visibleLimit=24;el("pickFilters").hidden=true;
  el("scanOutput").innerHTML='<div class="empty">Select games and scan verified PropLine sportsbook OVER lines.</div>';
}
function setOptions(id,entries,label){
  const node=el(id),previous=node.value;
  node.innerHTML='<option value="all">'+safe(label)+'</option>'+
    entries.map(v=>'<option value="'+safe(v)+'">'+safe(v)+'</option>').join("");
  node.value=entries.includes(previous)?previous:"all";
}
function filtered(){
  const m=el("filterMarket").value,t=el("filterTeam").value,
    p=el("filterPosition").value;
  return cards.filter(c=>(m==="all"||c.market===m)&&
    (t==="all"||c.team===t)&&(p==="all"||c.position===p));
}
function outcomeCell(g,line){
  const cls=g.result==="OVER"?"over":g.result==="UNDER"?"below":"push";
  return '<div class="game-log-row" role="row">'+
    '<span class="game-log-date" role="cell">'+safe(prettyDate(g.date))+'</span>'+
    '<strong class="game-log-opponent" role="cell">'+safe(g.opponent)+'</strong>'+
    '<strong class="game-log-stat" role="cell">'+safe(g.actual)+
      '<small class="game-log-line">OVER '+safe(line)+'</small></strong>'+
    '<span class="game-log-status '+cls+'" role="cell">'+safe(g.result)+'</span>'+
    '</div>';
}
function historyBlock(label,games,line,similar=false){
  return '<details class="game-log-section" '+(similar?'':'open')+'>'+
    '<summary class="game-log-title"><strong>'+safe(label)+'</strong>'+
    '<span>'+games.length+' verified games</span></summary>'+
    '<div class="game-log-table" role="table">'+
    '<div class="game-log-header" role="row"><span>Date</span><span>Opponent</span>'+
    '<span>Recorded stat</span><span>Result</span></div>'+
    games.map(g=>outcomeCell(g,line)+(similar?
      '<div class="game-log-method">Similarity: '+safe(g.similarity)+"% · "+
      safe(g.defenseReason)+'</div>':'')).join("")+'</div></details>';
}
function hitText(x){return x.tracked?x.hits+"/"+x.tracked+
  " — "+x.percent+"%":"Not verified (0 games)";}
function renderCard(c){
  const rec=c.recommendation==="OVER";
  const total=c.similar.tracked;
  return '<article class="scan-card">'+
    '<div class="scan-top"><div class="scan-identity">'+
      '<div class="player-initial">'+safe(c.player.split(" ").map(v=>v[0]).slice(0,2).join(""))+'</div>'+
      '<div><strong>'+safe(c.player)+'</strong><small>'+safe(c.team)+' vs '+safe(c.opponent)+'</small>'+
      '<small>'+safe(c.position)+" · "+safe(c.variant==="alternative"?"ALT PropLine":"Standard PropLine")+
      '</small></div></div>'+
      '<span class="trend-badge'+(rec?'':' trend-unverified')+'">'+
        (rec?"OVER supported":"INSUFFICIENT / MIXED EVIDENCE")+'</span></div>'+
    '<div class="scan-line">VERIFIED PROPLINE '+safe(c.variant==="alternative"?"ALT":"STANDARD")+
      ' PROJECTION: <strong>'+safe(c.line)+'</strong> '+safe(c.market)+'</div>'+
    '<p class="season-evidence">Book quote last updated '+safe(kickoff(c.quotedAt))+
      ' · Three-season window '+safe(c.seasonWindow.join(" / "))+'</p>'+
    '<div class="scan-stats">'+
      '<div><strong>'+safe(hitText(c.recent))+'</strong><small>Last five current-season games</small></div>'+
      '<div><strong>'+safe(hitText(c.similar))+'</strong><small>Similar defenses — three seasons</small></div>'+
      '<div><strong>'+safe(total)+'</strong><small>Verified qualifying historical matchups</small></div>'+
    '</div>'+
    '<p class="muted matchup-rationale">'+(rec?"Recommendation: OVER "+safe(c.line)+" "+safe(c.market)+". ":"No OVER recommendation. ")+
      safe(c.why)+'</p>'+
    historyBlock("Recent Games — Current Season",c.recentGames,c.line)+
    historyBlock("Similar Defenses — Last 3 Seasons",c.similarGames,c.line,true)+
    (c.limitations.length?'<p class="sample-warning">'+c.limitations.map(safe).join(" · ")+'</p>':'')+
    '<p class="season-evidence">Injuries, lineup status and future snap/minute shares are not independently confirmed by this provisional ESPN source. Verify current availability before using the research.</p>'+
    '<div class="research-label">Historical percentages are observed results, not probabilities. The current sportsbook quote is compared against prior games; it is not claimed as their historical betting line.</div>'+
    '</article>';
}
function renderCards(){
  const items=filtered(),shown=items.slice(0,visibleLimit);
  el("pickResultCount").textContent=shown.length+" shown · "+items.length+
    " matching · "+cards.length+" verified player-prop cards";
  const mount=el("pickCardMount");
  if(mount)mount.innerHTML=shown.length
    ?'<div class="scan-grid">'+shown.map(renderCard).join("")+'</div>'+
      (shown.length<items.length?'<div class="load-picks-row"><button id="loadMorePicks" class="secondary">Show more evidence</button></div>':"")
    :'<div class="empty">No verified props match the chosen filters.</div>';
  const more=el("loadMorePicks");if(more)more.onclick=()=>{visibleLimit+=24;renderCards();};
}
function drawGames(){
  el("count").textContent=selected.size+" / 16 games selected";
  el("games").innerHTML=games.length?games.map(g=>
    '<button class="game '+(selected.has(String(g.id))?"active":"")+
    '" data-id="'+safe(g.id)+'" aria-pressed="'+selected.has(String(g.id))+'">'+
    (g.away?.logo?'<img alt="" src="'+safe(g.away.logo)+'">':"")+
    '<div>'+safe(g.away?.name)+" @ "+safe(g.home?.name)+
    '<small>'+safe(kickoff(g.date))+" · "+safe(g.status)+'</small></div>'+
    (g.home?.logo?'<img alt="" src="'+safe(g.home.logo)+'">':"")+
    '<b>'+(selected.has(String(g.id))?"✓":"+")+'</b></button>').join("")
    :'<div class="empty">No scheduled games returned. Try another date.</div>';
  el("games").querySelectorAll("button").forEach(btn=>{
    btn.onclick=()=>{
      const id=btn.dataset.id;
      if(selected.has(id))selected.delete(id);
      else if(selected.size<16)selected.add(id);
      else{status("Choose up to 16 games.");return;}
      drawGames();
    };
  });
}
async function loadGames(){
  const own=++scanId;
  selected.clear();games=[];clearResults();status("Loading verified schedules…");
  el("scheduleStatus").textContent="Loading schedules…";
  const date=el("date").value,league=el("league").value;
  const params=new URLSearchParams({sport,date,...(sport==="soccer"?{league}:{})});
  try{
    const response=await fetch("/api/games?"+params);
    const data=await response.json();
    if(!response.ok||!Array.isArray(data.games))throw Error(data.error||"Schedule unavailable");
    if(own!==scanId)return;
    games=data.games;
    el("scheduleStatus").textContent=games.length+" games · "+(data.source||"ESPN");
    status("Choose up to 16 games. PropLine requires a configured API key before scanning real sportsbook lines.");
  }catch(error){
    if(own!==scanId)return;
    el("scheduleStatus").textContent="Schedules unavailable: "+error.message;
    status("No game schedule evidence available.");
  }
  drawGames();
}
function fixtureMatches(offer,game){
  const a=normalize(game.away.name),h=normalize(game.home.name);
  const sameEvent=offer.gameId && String(offer.gameId)===String(game.id);
  const matchedNames=normalize(offer.fixture?.home)===h &&
    normalize(offer.fixture?.away)===a;
  return Boolean(sameEvent||matchedNames);
}
async function scan(){
  const chosen=games.filter(g=>selected.has(String(g.id)));
  if(!chosen.length){status("Select at least one game.");return;}
  const own=++scanId,day=el("date").value,league=el("league").value,
    currentSport=sport,button=el("scanSelected");
  button.disabled=true;button.textContent="Scanning verified evidence…";
  clearResults();status("Requesting real sportsbook OVER lines from PropLine…");
  try{
    const response=await fetch("/api/lines?"+new URLSearchParams({sport:currentSport,date:day,league}),
      {headers:{Accept:"application/json"},cache:"no-store"});
    const feed=await response.json();
    if(own!==scanId)return;
    if(!response.ok||feed.status!=="connected"){
      el("scanOutput").innerHTML='<div class="warning"><strong>PropLine integration unavailable</strong>'+
        '<p>'+safe(feed.error||"A PropLine API key is required. No fabricated lines will be generated.")+
        '</p><p>Current projections cannot be verified. Get a free key at prop-line.com/pricing, then add PROPLINE_API_KEY to Cloudflare Pages secrets. Historical research never substitutes made-up lines.</p></div>';
      status("No verified PropLine lines. Scanner safely stopped.");
      return;
    }
    const chosenPairs=[];
    const rejected=[];
    for(const offer of feed.projections||[]){
      const matching=chosen.filter(game=>fixtureMatches(offer,game));
      if(matching.length===1)chosenPairs.push({offer,game:matching[0]});
      else if(matching.length>1)rejected.push("Ambiguous fixture for "+offer.player);
    }
    watchedQuotes={sport:currentSport,date:day,league,
      offers:new Map(chosenPairs.map(({offer})=>[offer.id,
        {line:offer.line,status:offer.status,variant:offer.variant,price:offer.price}]))};
    const preface='<p class="season-evidence">PropLine lines last verified: '+
      safe(feed.sourceFetchedAt)+" · "+chosenPairs.length+
      ' active sportsbook OVER lines for selected games · Changes: '+
      safe(feed.changeTracking==="verified"?feed.changes.length+" tracked":
        "Tracking requires Cloudflare KV")+'</p>';
    el("scanOutput").innerHTML=preface+
      '<div class="empty">Loading actual athlete boxscores and pregame defensive records…</div>';
    if(!chosenPairs.length){
      el("scanOutput").innerHTML=preface+
        '<div class="empty">No supported, fresh sportsbook OVER lines match the selected fixtures. Unavailable or suspended lines were excluded.</div>';
      status("Verified board queried; no available matching projections.");
      return;
    }
    const client=makeEvidenceClient({concurrency:6,onProgress:x=>{
      if(own===scanId)status("Verified ESPN documents: "+x.completed+
        " · active requests: "+x.active);
    }});
    const results=[],errors=[],counts={completed:0};
    // Sequential per offer to avoid saturating free hosting while shared
    // document cache deduplicates schedules and completed event boxes.
    for(const {offer,game} of chosenPairs){
      if(own!==scanId)return;
      try{
        const input=await loadVerifiedEvidence({
          client,offer,game,league,
          onStage:stage=>{if(own===scanId)status(stage);}
        });
        const confirmedOffer={...offer,position:input.player.position,
          team:input.team.name,opponent:input.enemy.name,
          espnPlayerId:input.player.id,
          league:currentSport==="soccer"?league:null};
        const card=analyzeVerifiedProp({offer:confirmedOffer,
          season:input.season,games:input.games,
          upcomingDefense:input.upcomingDefense,
          defensiveProfiles:input.defensiveProfiles});
        if(card)results.push(card);
      }catch(e){errors.push(offer.player+" / "+offer.market+": "+e.message);}
      counts.completed++;
      if(own===scanId)status("Verified offers analyzed: "+counts.completed+
        "/"+chosenPairs.length);
    }
    if(own!==scanId)return;
    cards=rankEvidence(results);
    el("pickFilters").hidden=!cards.length;
    if(cards.length){
      const uniq=a=>[...new Set(a)].sort();
      setOptions("filterMarket",uniq(cards.map(c=>c.market)),"All stats");
      setOptions("filterTeam",uniq(cards.map(c=>c.team)),"All teams");
      setOptions("filterPosition",uniq(cards.map(c=>c.position)),"All positions");
    }
    el("scanOutput").innerHTML=preface+
      '<p class="muted">PropLine sportsbook lines analyzed: '+counts.completed+
      ' · Evidence cards: '+cards.length+
      ' · OVER recommendations with sufficient evidence: '+
      cards.filter(c=>c.recommendation==="OVER").length+'.</p>'+
      (errors.length?'<details class="warning"><summary>'+errors.length+
        ' unverified player/market records withheld</summary><p>'+
        errors.slice(0,20).map(safe).join(" · ")+'</p></details>':"")+
      (cards.length?'<div id="pickCardMount"></div>':
        '<div class="empty">No verifiable historical evidence was available for the returned sportsbook lines. No placeholders were generated.</div>');
    if(cards.length)renderCards();
    status("Evidence scan finished. Every displayed line came from the verified PropLine feed.");
  }catch(e){
    if(own!==scanId)return;
    el("scanOutput").innerHTML='<div class="error">Source validation failed: '+
      safe(e.message)+". No unsourced projections displayed.</div>";
    status("Research unavailable; source validation failed.");
  }finally{
    if(own===scanId){button.disabled=false;button.textContent="⚡ Scan Selected Games";}
  }
}
// Poll only while a verified board is open. If the provider removes/suspends or
// changes a quote, discard old evidence and force a new source-verified scan.
setInterval(async()=>{
  const snapshot=watchedQuotes;
  if(!snapshot||watchBusy||document.visibilityState==="hidden")return;
  watchBusy=true;
  try{
    const response=await fetch("/api/lines?"+new URLSearchParams({
      sport:snapshot.sport,date:snapshot.date,league:snapshot.league
    }),{cache:"no-store"});
    const feed=await response.json();
    if(snapshot!==watchedQuotes)return;
    if(!response.ok||feed.status!=="connected"){
      clearResults();status("PropLine quote verification expired or became unavailable. Rescan after reconnecting.");
      return;
    }
    const latest=new Map(feed.projections.map(p=>[p.id,p]));
    for(const [id,old] of snapshot.offers){
      const current=latest.get(id);
      if(!current||current.line!==old.line||
        current.variant!==old.variant||current.price!==old.price||current.status!=="active"){
        clearResults();
        el("scanOutput").innerHTML='<div class="warning">PropLine projection moved, was suspended, or was removed. Old cards have been cleared. Scan again for current verified lines.</div>';
        status("PropLine board changed — rescan required.");
        return;
      }
    }
  }catch{
    if(snapshot===watchedQuotes){
      clearResults();status("PropLine feed verification failed — old quotes were cleared.");
    }
  }finally{watchBusy=false;}
},120000);
el("sports").innerHTML=Object.entries(SPORTS)
  .map(([id,label])=>'<button data-s="'+id+'">'+safe(label)+'</button>').join("");
el("sports").querySelectorAll("button").forEach(btn=>
  btn.addEventListener("click",()=>{
    sport=btn.dataset.s;
    el("sports").querySelectorAll("button").forEach(b=>b.classList.toggle("active",b===btn));
    el("leagueWrap").hidden=sport!=="soccer";loadGames();
  }));
el("league").innerHTML=Object.entries(LEAGUES)
  .map(([id,name])=>'<option value="'+id+'">'+safe(name)+'</option>').join("");
el("date").value=new Date().toLocaleDateString("en-CA",{timeZone:"America/Chicago"});
el("date").onchange=loadGames;el("league").onchange=loadGames;
el("refresh").onclick=loadGames;el("scanSelected").onclick=scan;
for(const id of ["filterMarket","filterTeam","filterPosition"])el(id).onchange=()=>{
  visibleLimit=24;renderCards();
};
el("sports").querySelector('[data-s="nfl"]').click();
