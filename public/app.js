/**
 * MATCHUP NIGHTMARE V3 — no legacy model.
 * The only entry point for automatic recommendations is a freshly verified
 * verified PropLine sportsbook quote followed by verified game-by-game evidence.
 */
import {analyzeVerifiedProp,rankEvidence} from "/lib/research-v3.js";
import {makeEvidenceClient,loadVerifiedEvidence} from "/lib/evidence-client-v3.js";
import {groupOffersByPlayerStat,selectBestOverCard,dedupeVerifiedCards}
  from "/lib/one-line-per-stat.js";
import {saveCompletedScan,readLastScan} from "/lib/last-scan-cache.js";
import {renderVerifiedHistory} from "/lib/verified-history-ui.js";
import {renderUpcomingDefense} from "/lib/defense-strength-ui.js";
import {renderPlayerCardHeader} from "/lib/player-profile-v3.js";
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
let watchedQuotes=null,watchBusy=false,quotaPaused=false;
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
// Keep the complete original game-by-game evidence inside an accessible
// collapsed section; its summary still shows the verified OVER hit count.
function historyBlock(label,games,line,similar=false,market="Recorded stat"){
  return renderVerifiedHistory({label,games,line,similar,market,
    formatDate:prettyDate});
}
function hitText(x){return x.tracked?x.hits+"/"+x.tracked+
  " — "+x.percent+"%":"Not verified (0 games)";}
function renderCard(c){
  const archived=Boolean(c.cachedAt);
  const rec=c.recommendation==="OVER";
  const total=c.similar.tracked;
  return '<article class="scan-card">'+
    renderPlayerCardHeader(c)+
    '<div class="scan-line">'+(archived?"LAST SAVED DRAFTKINGS SELECTION: ":
      c.offer?.quoteShape==="milestone"?"VERIFIED DRAFTKINGS MILESTONE: ":
      "PROPLINE VERIFIED OVER LINE: ")+'<strong>'+
      safe(c.offer?.quoteShape==="milestone"?
        c.offer.selectionLabel||c.offer.minimumStat+"+ "+c.market:c.line)+
      '</strong>'+(c.offer?.quoteShape==="milestone"?
        ' · equivalent OVER '+safe(c.line)+' '+safe(c.market):
        ' '+safe(c.market))+
      (Number.isFinite(c.price)?' · '+safe(c.price>0?'+':'')+safe(c.price):'')+
      ' · '+safe(c.book)+'</div>'+
    renderUpcomingDefense(c.currentDefenseStrength,{
      opponent:c.opponent,sport:c.sport
    })+
    (archived?'<p class="sample-warning">Previously saved research from '+
      safe(kickoff(c.cachedAt))+
      '. The price, line and player availability have NOT been reverified. Do not treat this as an active sportsbook offer.</p>':'')+
    '<div class="scan-stats">'+
      '<div><strong>'+safe(hitText(c.recent))+'</strong><small>Last five current-season games</small></div>'+
      '<div><strong>'+safe(hitText(c.similar))+'</strong><small>Similar defenses — three seasons</small></div>'+
      '<div><strong>'+safe(total)+'</strong><small>'+
        (c.matchupSampleTarget?'Distinct similar defenses (3–6 target)':
          'Verified qualifying historical matchups')+'</small></div>'+
    '</div>'+
    '<p class="muted matchup-rationale">'+(archived
      ?(rec?"Previously supported OVER "+safe(c.line)+" "+safe(c.market)+
        ". Recheck live availability before using. ":"Previously insufficient evidence; cached scan only. ")
      :rec?"Recommendation: OVER "+safe(c.line)+" "+safe(c.market)+". ":
        "No OVER recommendation. ")+
      safe(c.why)+'</p>'+
    historyBlock("Similar Defenses — Last 3 Seasons",c.similarGames,
      c.line,true,c.market)+
    historyBlock("Recent Matchups — Last 5 Games",c.recentGames,
      c.line,false,c.market)+
    '</article>';
}
function renderCards(){
  const items=filtered(),shown=items.slice(0,visibleLimit);
  el("pickResultCount").textContent=shown.length+" shown · "+items.length+
    " matching · "+cards.length+
    (cards.some(c=>c.cachedAt)?" saved research cards (NOT LIVE)":" verified player-prop cards");
  const mount=el("pickCardMount");
  if(mount)mount.innerHTML=shown.length
    ?'<div class="scan-grid">'+shown.map(renderCard).join("")+'</div>'+
      (shown.length<items.length?'<div class="load-picks-row"><button id="loadMorePicks" class="secondary">Show more evidence</button></div>':"")
    :'<div class="empty">No verified props match the chosen filters.</div>';
  // Failed/missing ESPN images reveal initials instead of a broken icon.
  if(mount)for(const image of mount.querySelectorAll("img[data-fallback-image]")){
    image.addEventListener("error",()=>image.remove(),{once:true});
    if(image.complete&&image.naturalWidth===0)image.remove();
  }
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
function scanStorage(){
  try{return window.localStorage;}catch{return null;}
}
function showSavedScan({chosen,day,league,currentSport,reason}){
  quotaPaused=true;
  const saved=readLastScan({sport:currentSport,date:day,league,
    games:chosen},scanStorage());
  watchedQuotes=null;
  if(!saved.cards.length){
    el("scanOutput").innerHTML='<div class="warning"><strong>PropLine free quota reached</strong>'+
      '<p>'+safe(reason)+
      '</p><p>No previous completed scan is saved in this browser for the selected upcoming game(s). Run a successful scan after the quota resets to create one. No substitute lines were generated.</p></div>';
    status("Quota exhausted; no compatible last scan saved on this device.");
    return;
  }
  cards=rankEvidence(dedupeVerifiedCards(saved.cards));
  // A second canonical fixture and athlete check applies to archived
  // research exactly as it does to fresh research.
  const seen=new Set();
  cards=cards.filter(c=>{
    const key=[c.sport,c.fixtureId,
      c.offer?.espnPlayerId||normalize(c.player),c.stat].join("|");
    if(seen.has(key))return false;seen.add(key);return true;
  });
  el("pickFilters").hidden=!cards.length;
  if(cards.length){
    const unique=a=>[...new Set(a)].sort();
    setOptions("filterMarket",unique(cards.map(c=>c.market)),"All stats");
    setOptions("filterTeam",unique(cards.map(c=>c.team)),"All teams");
    setOptions("filterPosition",unique(cards.map(c=>c.position)),"All positions");
  }
  el("scanOutput").innerHTML='<div class="warning"><strong>LAST SAVED SCAN — NOT LIVE</strong>'+
    '<p>'+safe(reason)+
    '</p><p>Showing '+cards.length+' previously researched player/stat cards from '+
    safe(kickoff(saved.oldestSavedAt))+
    '. These odds and player statuses may have changed. '+
    (saved.missing.length?'No saved results for '+saved.missing.length+
      ' selected game(s). ':'')+
    'Historical percentages are from the saved scan, not new data.</p></div>'+
    (cards.length?'<div id="pickCardMount"></div>':'');
  if(cards.length)renderCards();
  status("Using last completed scan (not live) — PropLine quota exhausted.");
}
function fixtureMatches(offer,game){
  const canonical=x=>String(x||"").normalize("NFKD").toLowerCase()
    .replace(/[\u0300-\u036f]/g,"")
    .replace(/\bstate\b/g,"st")
    .replace(/\bman\b/g,"manchester").replace(/\butd\b/g,"united")
    .replace(/\bfc\b|\bcf\b/g,"")
    .replace(/[^a-z0-9]/g,"");
  const equivalent=(x,y)=>{
    const a=canonical(x),b=canonical(y);
    if(!a||!b)return false;
    if(a===b||a.length>=8&&b.length>=8&&
      (a.endsWith(b)||b.endsWith(a)||
        a.length>=10&&b.length>=10&&
        (a.startsWith(b)||b.startsWith(a))))return true;
    if(["nfl","nba","mlb"].includes(offer.sport)){
      const mascot=v=>String(v||"").toLowerCase().trim()
        .split(/[^a-z0-9]+/).filter(Boolean).at(-1)||"";
      const m=mascot(x);
      return m.length>=4&&m===mascot(y);
    }
    return false;
  };
  const sameEvent=offer.gameId && String(offer.gameId)===String(game.id);
  const matchedNames=equivalent(offer.fixture?.home,game.home?.name)&&
    equivalent(offer.fixture?.away,game.away?.name);
  return Boolean(sameEvent||matchedNames);
}
async function scan(){
  const chosen=games.filter(g=>selected.has(String(g.id)));
  if(!chosen.length){status("Select at least one game.");return;}
  const own=++scanId,day=el("date").value,league=el("league").value,
    currentSport=sport,button=el("scanSelected");
  button.disabled=true;button.textContent="Scanning verified evidence…";
  clearResults();status("Requesting DraftKings OVER lines through PropLine…");
  try{
    if(quotaPaused){
      showSavedScan({chosen,day,league,currentSport,
        reason:"This browser already detected PropLine's free API limit. Showing the last completed scan without another API request. Reload after your limit resets to retry live quotes."});
      return;
    }
    const fixtures=chosen.map(g=>({id:g.id,home:g.home.name,away:g.away.name}));
    const response=await fetch("/api/lines?"+new URLSearchParams({
      sport:currentSport,date:day,league,fixtures:JSON.stringify(fixtures)
    }),{headers:{Accept:"application/json"},cache:"no-store"});
    const feed=await response.json();
    if(own!==scanId)return;
    if(response.status===429||feed.status==="rate-limited"){
      showSavedScan({chosen,day,league,currentSport,
        reason:"PropLine has reached its request limit. Showing only saved research where available."});
      return;
    }
    if(!response.ok||feed.status!=="connected"){
      const keyMissing=feed.status==="integration-required";
      const sportMissing=feed.status==="sport-unavailable";
      const issue=keyMissing?"PropLine API key not connected":
        sportMissing?"Selected sport has no verified PropLine market":
        "Sportsbook data temporarily unavailable";
      el("scanOutput").innerHTML='<div class="warning"><strong>'+
        safe(issue)+'</strong><p>'+
        safe(feed.error||"The selected event's real sportsbook prop feed is unavailable.")+
        '</p><p>'+(keyMissing?
          "Add PROPLINE_API_KEY in Cloudflare Pages production secrets.":
          sportMissing?"This can be a sportsbook or league coverage limit, not a missing API key.":
          "No substitute odds will be generated. Retry when the source becomes available.")+
        '</p></div>';
      status("No verified props for this sport and date. Scanner safely stopped.");
      return;
    }
    quotaPaused=Number(feed.dailyRequestsRemaining)===0 &&
      feed.dailyRequestsRemaining!==null;
    const chosenPairs=[];
    const rejected=[];
    for(const offer of feed.projections||[]){
      // Fail closed if upstream ever exposes another bookmaker by mistake.
      if(offer.bookKey!=="draftkings")continue;
      const matching=chosen.filter(game=>fixtureMatches(offer,game));
      if(matching.length===1)chosenPairs.push({offer,game:matching[0]});
      else if(matching.length>1)rejected.push("Ambiguous fixture for "+offer.player);
    }
    const grouped=groupOffersByPlayerStat(chosenPairs);
    // Only the selected DraftKings quote is monitored after ranking;
    // alternate points never create additional player/stat cards.
    const preface='<p class="season-evidence">PropLine · DraftKings sportsbook lines retrieved: '+
      safe(feed.sourceFetchedAt)+" · "+chosenPairs.length+
      ' active DraftKings OVER quotes for selected games · '+
      safe(feed.eventsChecked??0)+' event board(s) checked · Changes: '+
      safe(feed.changeTracking==="verified"?feed.changes.length+" tracked":
        "Tracking requires Cloudflare KV")+'</p>';
    el("scanOutput").innerHTML=preface+
      '<div class="empty">Loading actual athlete boxscores and pregame defensive records…</div>';
    if(!chosenPairs.length){
      watchedQuotes=null;
      const diagnostics=feed.diagnostics||{};
      const providerCount=(feed.projections||[]).length;
      const reason=providerCount?
        "PropLine returned "+providerCount+
        " DraftKings player quotes, but they could not be safely linked to the selected ESPN fixtures.":
        (feed.eventsChecked||0)===0?
        "The selected games could not be matched to a PropLine event on this date.":
        (feed.eventsFailed||0)>0?
        "PropLine did not return usable prices for one or more selected events.":
        diagnostics.draftKingsBoards===0?
        "DraftKings has not posted a player-prop board for the selected games.":
        diagnostics.supportedMarkets===0?
        "DraftKings has not posted supported player-stat markets for the selected games.":
        diagnostics.freshMarkets===0?
        "The DraftKings player-stat quotes are suspended or older than our freshness limit.":
        "No valid DraftKings OVER or equivalent player milestone selections are currently listed.";
      el("scanOutput").innerHTML=preface+
        '<div class="empty">'+safe(reason)+
        ' Try another upcoming fixture or check later for newly posted markets. We do not invent lines.</div>';
      status("Verified board queried; no available matching projections.");
      return;
    }
    const client=makeEvidenceClient({concurrency:6,onProgress:x=>{
      if(own===scanId)status("Verified ESPN documents: "+x.completed+
        " · active requests: "+x.active);
    }});
    const results=[],errors=[],counts={completed:0};
    // Fetch one verified history per player/stat/game, regardless of how many
    // alternative quotes or sportsbooks PropLine returned for that market.
    for(const group of grouped){
      if(own!==scanId)return;
      const offer=group.offers.find(x=>x.espnPlayerId)||group.offers[0];
      const game=group.game;
      try{
        if(group.identityConflict)throw Error(
          "Conflicting provider athlete IDs for the same player/stat.");
        const input=await loadVerifiedEvidence({
          client,offer,game,league,
          onStage:stage=>{if(own===scanId)status(stage);}
        });
        const candidates=[];
        for(const quote of group.offers){
          if(quote.espnPlayerId&&String(quote.espnPlayerId)!==input.player.id)
            continue;
          const confirmedOffer={...quote,position:input.player.position,
            team:input.team.name,opponent:input.enemy.name,
            espnPlayerId:input.player.id,
            league:currentSport==="soccer"?league:null};
          const card=analyzeVerifiedProp({offer:confirmedOffer,
            season:input.season,games:input.games,
            upcomingDefense:input.upcomingDefense,
            upcomingContext:input.upcomingContext,
            defensiveProfiles:input.defensiveProfiles,
            matchupModel:input.matchupModel});
          if(card)candidates.push(card);
        }
        // One winner, with all displayed evidence based on its exact line.
        const chosen=selectBestOverCard(candidates);
        if(chosen)results.push({...chosen,fixtureId:String(game.id),
          quotesConsidered:group.offers.length,
          visuals:{
            headshotUrl:input.player.visuals?.headshotUrl||null,
            teamLogo:input.team.logo||null,
            opponentLogo:input.enemy.logo||null,
            injury:input.player.visuals?.injury||{
              label:"Status not confirmed",kind:"unknown",
              source:"ESPN team roster",checkedAt:null
            }
          }});
      }catch(e){errors.push(offer.player+" / "+offer.market+": "+e.message);}
      counts.completed++;
      if(own===scanId)status("Unique player/stat markets analyzed: "+
        counts.completed+"/"+grouped.length);
    }
    if(own!==scanId)return;
    cards=rankEvidence(dedupeVerifiedCards(results));
    // A second mandatory, canonical-fixture deduplication before display
    // ensures one DraftKings OVER card for each verified player + stat.
    const uniqueKeys=new Set();
    cards=cards.filter(card=>{
      const key=[card.sport,card.fixtureId,
        card.offer?.espnPlayerId||normalize(card.player),card.stat].join("|");
      if(uniqueKeys.has(key))return false;
      uniqueKeys.add(key);
      return true;
    });
    watchedQuotes=cards.length?{sport:currentSport,date:day,league,
      fixtures:chosen.map(g=>({id:g.id,home:g.home.name,away:g.away.name})),
      offers:new Map(cards.map(c=>[c.id,{
        line:c.line,status:"active",variant:c.variant,price:c.price
      }]))}:null;
    el("pickFilters").hidden=!cards.length;
    if(cards.length){
      const uniq=a=>[...new Set(a)].sort();
      setOptions("filterMarket",uniq(cards.map(c=>c.market)),"All stats");
      setOptions("filterTeam",uniq(cards.map(c=>c.team)),"All teams");
      setOptions("filterPosition",uniq(cards.map(c=>c.position)),"All positions");
    }
    el("scanOutput").innerHTML=preface+
      '<p class="muted">Unique player/stat markets analyzed: '+counts.completed+
      ' · DraftKings quotes checked: '+chosenPairs.length+
      ' · One DraftKings line per stat: '+cards.length+
      ' · OVER recommendations with sufficient evidence: '+
      cards.filter(c=>c.recommendation==="OVER").length+'.</p>'+
      (errors.length?'<details class="warning"><summary>'+errors.length+
        ' unverified player/market records withheld</summary><p>'+
        errors.slice(0,20).map(safe).join(" · ")+'</p></details>':"")+
      (cards.length?'<div id="pickCardMount"></div>':
        '<div class="empty">No verifiable historical evidence was available for the returned DraftKings lines. No placeholders were generated.</div>');
    if(cards.length)renderCards();
    const saved=saveCompletedScan({sport:currentSport,date:day,league,
      games:chosen,cards},scanStorage());
    if(saved.failed)status("Scan finished. Browser couldn't save "+
      saved.failed+" game(s); check available local storage.");
    else if(saved.saved)status("Scan finished and last successful scan saved for "+
      saved.saved+" game(s). "+(quotaPaused?
      "PropLine quota is empty; saved scan will be used next time.":""));
    else status("Scan finished, but no complete player cards could be saved for this matchup.");

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
  if(!snapshot||watchBusy||quotaPaused||document.visibilityState==="hidden")return;
  watchBusy=true;
  try{
    const response=await fetch("/api/lines?"+new URLSearchParams({
      sport:snapshot.sport,date:snapshot.date,league:snapshot.league,
      fixtures:JSON.stringify(snapshot.fixtures)
    }),{cache:"no-store"});
    const feed=await response.json();
    if(snapshot!==watchedQuotes)return;
    if(response.status===429||feed.status==="rate-limited"){
      showSavedScan({chosen:games.filter(g=>selected.has(String(g.id))),
        day:snapshot.date,league:snapshot.league,currentSport:snapshot.sport,
        reason:"PropLine ran out of free API requests during its quote refresh."});
      return;
    }
    if(!response.ok||feed.status!=="connected"){
      clearResults();status("PropLine quote verification expired or became unavailable. Rescan after reconnecting.");
      return;
    }
    if(feed.dailyRequestsRemaining!==null&&
      Number(feed.dailyRequestsRemaining)===0)quotaPaused=true;
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
},600000);
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
