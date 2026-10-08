import {analyze,parseLogs} from "/lib/engine.js";
import {renderGameHistory} from "/lib/game-history.js";
import {combineSeasonBatches,seasonsFor} from "/lib/three-seasons.js";
import {eligibleCareerPlayers} from "/lib/career-candidates.js";
import {FIXED_SCAN,INITIAL_FILTERS,getPickOptions,filterPickCards} from "/lib/pick-filters.js";
import {parseApiResponse} from "/lib/api-client.js";
const sports={
nfl:{label:"🏈 NFL",markets:["Passing yards","Passing attempts","Completions","Rushing yards","Rushing attempts","Receptions","Receiving yards","Targets"]},
nba:{label:"🏀 NBA",markets:["Points","Rebounds","Assists","3-pointers","PRA","Steals","Blocks"]},
mlb:{label:"⚾ MLB",markets:["Hits","Total bases","Home runs","RBIs","Runs","Pitcher strikeouts","Pitching outs"]},
ncaaf:{label:"🏈 College Football",markets:["Passing yards","Completions","Passing attempts","Rushing yards","Receptions","Receiving yards"]},
ncaab:{label:"🏀 College Basketball",markets:["Points","Rebounds","Assists","3-pointers","PRA"]},
soccer:{label:"⚽ Men's Soccer",markets:["Shots","Shots on target","Goals","Assists","Saves","Tackles","Passes"]}};
const leagues={"eng.1":"Premier League","esp.1":"La Liga","ger.1":"Bundesliga","ita.1":"Serie A","fra.1":"Ligue 1","usa.1":"MLS","uefa.champions":"Champions League"};
const el=id=>document.getElementById(id),safe=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
let current="nfl",games=[],selected=new Set();
const PAGE_SIZE=24;
let allPickCards=[],visiblePickLimit=PAGE_SIZE;
function central(iso){try{return new Intl.DateTimeFormat("en-US",{timeZone:"America/Chicago",month:"short",day:"numeric",hour:"numeric",minute:"2-digit",timeZoneName:"short"}).format(new Date(iso));}catch{return "Time unavailable";}}
function chooseSport(s){current=s;selected.clear();el("sports").querySelectorAll("button").forEach(b=>b.classList.toggle("active",b.dataset.s===s));el("market").innerHTML=sports[s].markets.map(m=>'<option>'+safe(m)+'</option>').join("");el("leagueWrap").hidden=s!=="soccer";loadGames();}
function drawGames(){el("count").textContent=selected.size+" / 16 games selected";el("games").innerHTML=games.length?games.map(g=>'<button class="game '+(selected.has(g.id)?"active":"")+'" data-id="'+safe(g.id)+'" aria-pressed="'+selected.has(g.id)+'">'+(g.away.logo?'<img alt="" src="'+safe(g.away.logo)+'">':"")+'<div>'+safe(g.away.name)+' @ '+safe(g.home.name)+'<small>'+central(g.date)+' · '+safe(g.status)+'</small></div>'+(g.home.logo?'<img alt="" src="'+safe(g.home.logo)+'">':"")+'<b>'+(selected.has(g.id)?"✓":"+")+'</b></button>').join(""):'<div class="empty">No games returned. Try another date.</div>';
el("games").querySelectorAll("button").forEach(b=>b.addEventListener("click",()=>{if(selected.has(b.dataset.id))selected.delete(b.dataset.id);else if(selected.size<16)selected.add(b.dataset.id);else return alert("Maximum 16 games");drawGames();}));}
async function loadGames(){clearAutomaticResearch();resetPickFilterInputs();games=[];selected.clear();el("games").innerHTML="";el("scheduleStatus").textContent="Loading real schedules…";let url="/api/games?sport="+current+"&date="+encodeURIComponent(el("date").value);if(current==="soccer")url+="&league="+encodeURIComponent(el("league").value);
try{const r=await fetch(url,{headers:{Accept:"application/json"}}),data=await parseApiResponse(r,"/api/games");games=data.games||[];el("scheduleStatus").textContent=games.length+" scheduled games · "+data.source;drawGames();}catch(e){el("scheduleStatus").textContent="Schedule unavailable: "+e.message;drawGames();}}
function metric(name,r){return '<div class="metric"><strong>'+(r.percentage===null?"—":r.percentage+"%")+'</strong><small>'+name+' · '+r.hits+'/'+r.total+' OVER · '+r.pushes+' pushes</small></div>';}
el("sports").innerHTML=Object.entries(sports).map(([id,x])=>'<button data-s="'+id+'">'+x.label+'</button>').join("");
el("sports").querySelectorAll("button").forEach(b=>b.addEventListener("click",()=>chooseSport(b.dataset.s)));
el("league").innerHTML=Object.entries(leagues).map(([id,x])=>'<option value="'+id+'">'+x+'</option>').join("");
el("date").value=new Date().toLocaleDateString("en-CA",{timeZone:"America/Chicago"});el("date").addEventListener("change",loadGames);el("league").addEventListener("change",loadGames);el("refresh").addEventListener("click",loadGames);
el("scan").addEventListener("click",()=>{
el("manualResults").hidden=false;
try{const name=el("player").value.trim(),market=el("market").value,raw=el("line").value;
if(!name)throw Error("Enter a player.");if(raw.trim()==="")throw Error("Enter an OVER line.");
const line=Number(raw);if(!Number.isFinite(line)||line<0)throw Error("Line must be nonnegative.");
const {games:logs,bad}=parseLogs(el("logs").value);if(!logs.length)throw Error("Enter at least one valid historical game log.");
const defense=el("defense").value.trim()?Number(el("defense").value):NaN;if(Number.isFinite(defense)&&defense<=0)throw Error("Position-specific allowed rate must be positive.");
const result=analyze(logs,line,defense);if(el("perfect").checked&&!result.historical100){el("output").innerHTML='<div class="empty">No 100% comparable trend with a minimum of three valid comparable games.</div>';return;}
const max=Math.max(1,line*1.2,...result.recent.map(g=>g.value));
el("output").innerHTML='<h2>'+safe(name)+' — OVER '+line+' '+safe(market)+'</h2><p class="muted">User-entered statistics only. Games selected: '+selected.size+'. Selecting games does not automatically populate players or verified markets.</p>'+
(bad.length?'<p class="error">Invalid input lines ignored: '+bad.join(", ")+'</p>':"")+
'<div class="metrics">'+metric("Last 5",result.last5)+metric("Last 10",result.last10)+metric("All supplied",result.season)+metric("Similar scoring defense",result.similar)+'</div>'+
'<h3>Recent games</h3><div class="chart">'+result.recent.slice().reverse().map(g=>'<div class="bar '+(g.value>line?"hit":"")+'" style="height:'+Math.max(3,100*g.value/max)+'%" title="'+safe(g.date+" "+g.opponent+" "+g.value)+'"></div>').join("")+'</div>'+
renderGameHistory(result.recent,line,market,{heading:"Recent game history",limit:15})+
'<h3>Similar positional defenses</h3><p class="muted">Compares manually entered allowed values for the SAME market and player position, within 20%. Data is unverified.</p>'+
renderGameHistory(result.similarGames,line,market,{heading:"Similar positional defenses (manual)",limit:8})+
'<div class="warning">Historical hit rates do not guarantee wins. No live sportsbook lines, verified player logs, injuries, or calibrated prediction model are connected.</div>';
}catch(e){el("output").innerHTML='<p class="error">'+safe(e.message)+'</p>';}
});
chooseSport("nfl");


/* Automatic fixed-rule scan. Optional manual research is below the pick results. */
const scanBtn=el("scanSelected");
const scanProgress=el("scanProgress");
/* The same three result filters work across all six sports. No API calls. */
for(const id of ["filterMarket","filterTeam","filterPosition"]){
  el(id).addEventListener("change",()=>{
    visiblePickLimit=PAGE_SIZE;
    drawFilteredPickCards();
  });
}
el("autoResults").addEventListener("click",event=>{
  if(event.target.closest("#loadMorePicks")){
    visiblePickLimit+=PAGE_SIZE;
    drawFilteredPickCards();
  }
});

function clearAutomaticResearch(){
  allPickCards=[];
  visiblePickLimit=PAGE_SIZE;
  el("pickFilters").hidden=true;
  el("scanOutput").innerHTML='<div class="empty">Select your games and click Scan Selected Games.</div>';
}
/** Reset only the browsing controls; the fixed scanner model never changes. */
function resetPickFilterInputs(){
  visiblePickLimit=PAGE_SIZE;
  for(const id of ["filterMarket","filterTeam","filterPosition"])
    el(id).value="all";
}
function collectPickFilters(){
  return {
    market:el("filterMarket").value,
    team:el("filterTeam").value,
    position:el("filterPosition").value
  };
}
function setPickSelectOptions(id,allLabel,entries){
  const select=el(id),old=select.value||"all";
  const options=entries.map(entry=>typeof entry==="string"
    ?{value:entry,label:entry}:entry);
  select.innerHTML='<option value="all">'+safe(allLabel)+'</option>'+
    options.map(entry=>'<option value="'+safe(entry.value)+'">'+safe(entry.label)+'</option>').join("");
  select.value=options.some(entry=>entry.value===old)?old:"all";
}
function refreshPickFilterChoices(picks){
  const options=getPickOptions(picks);
  setPickSelectOptions("filterMarket","All stats",options.markets);
  setPickSelectOptions("filterTeam","All teams",options.teams);
  setPickSelectOptions("filterPosition","All positions",options.positions);
  el("pickFilters").hidden=picks.length===0;
}
function drawFilteredPickCards(){
  const mount=el("pickCardMount");
  if(!mount)return;
  const matched=filterPickCards(allPickCards,collectPickFilters());
  const visible=matched.slice(0,visiblePickLimit);
  const count=el("pickResultCount");
  count.textContent=visible.length+" shown · "+matched.length+" matching · "+
    allPickCards.length+" total scan cards";
  mount.innerHTML=matched.length
    ?'<div class="scan-grid">'+visible.map(renderPickCard).join("")+'</div>'+
      (visible.length<matched.length
        ?'<div class="load-picks-row"><button type="button" id="loadMorePicks" class="secondary">'+
          'Show '+Math.min(PAGE_SIZE,matched.length-visible.length)+' more picks'+
          ' ('+(matched.length-visible.length)+' remaining)</button></div>':"")
    :'<div class="empty filtered-empty">No picks match this combination. Choose All stats, All teams, or All positions to broaden the results.</div>';
}
function renderPickCard(p){
  const ratio=(hits,sample)=>sample>0
    ?hits+"/"+sample+" · "+Math.round(hits/sample*100)+"%"
    :"Not verified";
  const hasSimilar=p.similarSample>0;
  const similarLabel=hasSimilar?ratio(p.similarHits,p.similarSample):"No verified matches";
  const recentLabel=ratio(p.recentHits,p.recentSample);
  const image=p.headshot
    ?'<img class="player-image" src="'+safe(p.headshot)+'" alt="" loading="lazy" onerror="this.hidden=true">'
    :'<div class="player-initial">'+safe(String(p.player).split(" ").map(x=>x[0]).slice(0,2).join(""))+'</div>';
  const recent=renderGameHistory(p.history,p.line,p.market,{
    heading:"Recent 5 Games — Current Season Only",
    limit:5,showYear:true,showLine:true,
    hitRate:{hits:p.recentHits,sample:p.recentSample}
  });
  const compared=(p.similarGames||[]).slice(0,4);
  const history=compared.length?renderGameHistory(compared,p.line,p.market,{
    heading:"Last 4 Matchups vs Similar Defenses — 3-Season Career",
    limit:4,showYear:true,showLine:true,
    showOpponentDefense:true,showComparableReason:true,showCareerTeam:true,
    countLabel:compared.length+" of 4 genuinely comparable",
    hitRate:{hits:p.similarHits,sample:p.similarSample}
  }):'<div class="similar-empty"><strong>No verified similar-defense trend</strong>'+
    '<span>0 of 4 comparable historical games available</span>'+
    '<p>'+safe(p.reason||"Verified defensive matchup data is unavailable.")+'</p></div>';
  const defense=Number.isFinite(p.targetDefense)
    ?p.targetDefense.toFixed(1):"Not verified";
  const defenseMetric=p.matchupMetric||"Position and stat-specific defense";
  const targetCount=p.targetDefenseGames>0?" · "+p.targetDefenseGames+" pregame records":"";
  const playerYears=(p.matchedSeasons||[]).join(", ")||"No verified comparable seasons";
  const careerLoaded=(p.careerSeasonsVerified||[]).join(", ")||"No separate athlete career logs";
  const knownTeam=p.careerTeamsIncluded?.length
    ?p.careerTeamsIncluded.length+" verified prior franchise(s)"
    :"No former team verified";
  const pctBadge=hasSimilar?Math.round(p.similarHits/p.similarSample*100)+"% MATCHUP"
    :"RECENT FORM ONLY";
  const badge=hasSimilar?similarLabel:recentLabel;
  const lineType=p.lineVerified
    ?"VERIFIED "+String(p.lineType||"SPORTSBOOK")+" OVER"
    :"RESEARCH-ONLY OVER";
  const scope=p.lineVerified
    ?"Quoted line: "+(p.marketSource||"verified price source")
    :"The research line is based on the player's current-season form. It is NOT a current PrizePicks/sportsbook line or payout offer.";
  return '<article class="scan-card">'+
    '<div class="scan-top"><div class="scan-identity">'+image+
      '<div><strong>'+safe(p.player)+'</strong><small>'+safe(p.teamName)+
      ' · '+safe(p.sourceGame?.away?.name)+' @ '+safe(p.sourceGame?.home?.name)+
      '</small><small>'+safe(p.position||"Position not verified")+'</small></div></div>'+
      '<span class="trend-badge'+(!hasSimilar?' trend-unverified':'')+'">'+safe(pctBadge)+
      ' · '+safe(badge)+(p.coveragePartial?' · PARTIAL DATA':'')+'</span></div>'+
    '<div class="scan-line">'+safe(lineType)+' <strong>'+safe(p.line)+'</strong> '+safe(p.market)+'</div>'+
    '<div class="scan-stats">'+
      '<div><strong>'+safe(recentLabel)+'</strong><small>Current-season recent trend</small></div>'+
      '<div><strong>'+safe(similarLabel)+'</strong><small>Three-season matchup trend</small></div>'+
      '<div><strong>'+safe(defense)+'</strong><small>'+safe(defenseMetric)+safe(targetCount)+'</small></div>'+
    '</div>'+
    '<p class="muted matchup-rationale">'+safe(p.reason)+'</p>'+
    '<p class="season-evidence">Recent games: '+safe(p.recentSeason)+
      ' season only · Similar-defense seasons verified: '+safe(playerYears)+
      ' · Separate career lookups: '+safe(careerLoaded)+' · '+safe(knownTeam)+'</p>'+
    recent+
    '<div class="similar-history'+(!hasSimilar?' similar-history-missing':'')+'">'+history+
      (hasSimilar?'<p class="game-log-method">Only exact player-position and stat-specific defenses within 25% of the upcoming opponent qualify. Each row explains its measured concession rate and evidence.</p>':'')+
    '</div>'+
    (p.sampleWarning?'<p class="sample-warning">'+safe(p.sampleWarning)+'</p>':'')+
    '<div class="research-label">'+safe(scope)+'</div>'+
    '<details><summary>How were these trends calculated?</summary>'+
      '<p class="muted">Recent form: '+safe(recentLabel)+' from recorded games in the selected season. '+
      'Matchup history: '+safe(similarLabel)+' from the last four verifiable defenses with comparable position/stat concessions over up to three seasons. '+
      'The threshold is not calculated from the minimum result of the matching historical games. '+
      'Availability, injuries, projected minutes, and role changes are not independently verified. A 100% past hit rate is not a future win probability.</p>'+
    '</details></article>';
}
function renderAutomaticResults(items,failures,completed){
  if(!items.length){
    allPickCards=[];
    el("pickFilters").hidden=true;
    const unavailable=failures.length>0;
    el("scanOutput").innerHTML=unavailable
      ?'<div class="empty"><strong>Scan unavailable — no picks were calculated.</strong><p class="muted">Cloudflare did not return the historical statistics required for this game. This is an API/deployment problem, not a zero-hit matchup.</p></div>'+
        failures.map(e=>'<p class="error">'+safe(e)+'</p>').join("")
      :'<div class="empty">No verified historical OVER research cards were found in the usable data. This is not a guaranteed prediction.</div>';
    return;
  }
  const all=items.flatMap(x=>(x.results||[]).map(p=>({...p,sourceGame:x.game,provider:x.provider})));
  allPickCards=all;
  refreshPickFilterChoices(all);

  const pendingCareerCount=items.reduce((n,x)=>n+(x.careerPlayersRemaining||0),0);
  const coverage=items.map(x=>{
    const requested=(x.yearsRequested||[]).join(", ");
    const loaded=(x.yearsLoaded||[]).join(", ");
    const label=(x.game?.away?.name||"Away")+" @ "+(x.game?.home?.name||"Home");
    const coverage=x.positionCoverage||{};
    const verified=coverage.resolvedPositionRows||0;
    const unknown=coverage.missingPositionRows||0;
    const roster=coverage.rostersWithPositions||0;
    const evidence=verified||unknown||roster
      ?'<span class="coverage-detail"> · Player positions verified: '+safe(verified)+
        ' · Missing: '+safe(unknown)+' · Roster lookups successful: '+safe(roster)+'</span>'
      :"";
    return '<p class="season-evidence">'+safe(label)+' · Searched seasons: '+
      safe(requested)+' · Usable seasons: '+safe(loaded||"None")+evidence+'</p>';
  }).join("");
  const warnings=items.flatMap(x=>x.notes||[]).filter(n=>/unavailable|missing|partial|incomplete|not loaded|roster|scheme|source request cap|current-season|limited lookback|same-team|lacked verified positions|position lookup/i.test(n));
  el("scanOutput").innerHTML='<p class="muted">Scanned '+completed+' selected matchup(s). Found '+all.length+' OVER research cards (hit rates calculated from actual recorded games). These are not live PrizePicks lines, quoted odds, or guaranteed outcomes.</p>'+
    coverage+(warnings.length?'<div class="warning">'+[...new Set(warnings)].map(safe).join(" · ")+'</div>':"")+
    (failures.length?'<div class="warning">'+safe(failures.length)+' games or partial data sources could not be analyzed. '+failures.slice(0,5).map(safe).join(" · ")+'</div>':"")+
    (pendingCareerCount?'<p class="warning">Career data was prioritized for active players. '+pendingCareerCount+
      ' additional player histories can still be checked.</p><button id="scanMoreCareers" class="gold">Scan more player careers ('+pendingCareerCount+' remaining)</button>':"")+
    (all.length?'<div id="pickCardMount"></div>':
      '<div class="empty">No historical OVER research cards could be calculated from the available season data. Missing historical boxscores or comparable opponents can also cause an empty scan.</div>');
  drawFilteredPickCards();
}
scanBtn.addEventListener("click",async()=>{
  const chosen=games.filter(g=>selected.has(g.id));
  if(!chosen.length){
    scanProgress.textContent="Select at least one matchup first.";
    clearAutomaticResearch();
    el("scanOutput").innerHTML='<div class="empty">Select one or more games, then press Scan Selected Games.</div>';
    return;
  }
  const sport=current,date=el("date").value,league=el("league").value;
  const mode=FIXED_SCAN.mode,window=FIXED_SCAN.window; // Always both trends, three seasons, OVER-only.
  resetPickFilterInputs();
  clearAutomaticResearch();
  const failures=[],states=[];
  let completed=0,cursor=0,seasonBatchesDone=0,careerBatchesDone=0;
  scanBtn.disabled=true;scanBtn.textContent="Scanning matchups…";
  el("scanOutput").innerHTML='<div class="empty">Scanning current-season games and historical position-specific defenses. Prior-team career lookups use verified athlete game logs when available.</div>';
  scanProgress.textContent="Loading current-season stats…";
  const rightPage=()=>sport===current&&date===el("date").value&&
    (sport!=="soccer"||league===el("league").value);

  async function requestSeason(game,season){
    // Cloudflare Free imposes a very small CPU budget per Pages Function.
    // Each request processes one team, then the browser merges verified
    // records and position profiles. No invented or averaged results.
    async function part(side){
      const q=new URLSearchParams({sport,date,gameId:game.id,mode,
        historySeason:String(season),focusTeam:side});
      if(sport==="soccer")q.set("league",league);
      try{
        const r=await fetch("/api/scan?"+q,{
          headers:{Accept:"application/json"}
        });
        const payload=await parseApiResponse(r,"/api/scan ("+side+", "+season+")");
        if(!payload.seasonBatch||payload.focusTeam!==side)
          throw Error("The "+side+" team's scan did not return a verified season batch.");
        return payload;
      }finally{seasonBatchesDone++;}
    }
    const sides=await Promise.allSettled([part("home"),part("away")]);
    const good=sides.filter(x=>x.status==="fulfilled").map(x=>x.value);
    const errors=sides.map((x,i)=>x.status==="rejected"
      ?(i===0?"Home":"Away")+" team: "+String(x.reason?.message||x.reason):null)
      .filter(Boolean);
    if(!good.length)throw Error(errors.join(" | ")||
      "Both Cloudflare historical API requests failed.");
    const first=good[0];
    const records={},profiles={},diagnostics={},notes=[];
    for(const piece of good){
      Object.assign(records,piece.seasonBatch.records||{});
      for(const [teamId,details] of Object.entries(piece.seasonBatch.defenseProfiles||{})){
        profiles[teamId]??={};
        Object.assign(profiles[teamId],details);
      }
      for(const [key,value] of Object.entries(piece.diagnostics||{})){
        if(typeof value==="number")diagnostics[key]=(diagnostics[key]||0)+value;
      }
      notes.push(...(piece.notes||[]));
    }
    if(errors.length)notes.push("Partial historical season: "+errors.join(" | "));
    return {
      ...first,notes,diagnostics,
      completeTeamSides:good.length,
      seasonBatch:{
        ...first.seasonBatch,teams:first.seasonBatch.teams,
        records,defenseProfiles:profiles
      }
    };
  }
  async function requestCareer(state,player,season){
    const game=state.game;
    const q=new URLSearchParams({sport,date,gameId:game.id,
      playerId:player.playerId,season:String(season)});
    // ESPN game logs may include a former franchise. Avoid re-fetching
    // appearances already verified from this player's current-team boxscores.
    const teamBatch=state.responses.find(x=>Number(x.season)===Number(season));
    const sourced=(teamBatch?.seasonBatch?.records?.[player.teamId]||[])
      .filter(g=>(g.players||[]).some(p=>String(p.id)===String(player.playerId)))
      .map(g=>String(g.id)).filter(id=>/^\d{5,15}$/.test(id)).slice(0,30);
    if(sourced.length)q.set("skip",sourced.join(","));
    if(sport==="soccer")q.set("league",league);
    try{
      const r=await fetch("/api/career?"+q,{headers:{Accept:"application/json"}});
      const data=await parseApiResponse(r,"/api/career ("+player.name+", "+season+")");
      if(!data.careerBatch)throw Error("Missing verified athlete career data.");
      return {...data,forTeamId:player.teamId};
    }finally{
      careerBatchesDone++;
      scanProgress.textContent="Cross-team career lookups completed: "+careerBatchesDone+
        " · Team-season batches: "+seasonBatchesDone+" · Games: "+completed+"/"+chosen.length;
    }
  }
  async function careerPool(state,players,seasons){
    const tasks=players.flatMap(player=>seasons.map(year=>({player,year})));
    const output=[],errors=[];
    let next=0;
    await Promise.all(Array.from({length:Math.min(2,tasks.length)},async()=>{
      while(next<tasks.length && rightPage()){
        const job=tasks[next++];
        try{output.push(await requestCareer(state,job.player,job.year));}
        catch(error){errors.push(job.player.name+" · "+job.year+": "+String(error.message).slice(0,110));}
      }
    }));
    return {output,errors};
  }
  function snapshot(){
    return states.map(state=>{
      const result=combineSeasonBatches(state.responses,{
        sport,mode,window,careerBatches:state.careerBatches,
        careerEligibleCount:state.candidateCount
      });
      result.careerPlayersRemaining=state.pendingPlayers.length;
      if(state.errors.length)result.notes.push(...state.errors.slice(0,6).map(e=>"Career source incomplete: "+e));
      return result;
    });
  }
  async function render(){
    if(!rightPage())return;
    let displayed=[];
    try{displayed=snapshot();}
    catch(error){failures.push(String(error.message));}
    renderAutomaticResults(displayed,failures,completed);
    const more=document.getElementById("scanMoreCareers");
    if(more){
      more.addEventListener("click",async()=>{
        if(!rightPage())return;
        more.disabled=true;more.textContent="Scanning more athlete careers…";
        const pending=states.filter(st=>st.pendingPlayers.length>0);
        for(const st of pending){
          // Follow-up work is explicit: request up to eight further career
          // players per selected game, two seasons each.
          const next=st.pendingPlayers.splice(0,8);
          const lookedUp=await careerPool(st,next,st.years);
          st.careerBatches.push(...lookedUp.output);
          st.errors.push(...lookedUp.errors);
        }
        await render();
      });
    }
  }
  async function worker(){
    while(cursor<chosen.length && rightPage()){
      const game=chosen[cursor++];
      const title=game.away.name+" @ "+game.home.name;
      try{
        const currentBatch=await requestSeason(game,"current");
        const years=seasonsFor(currentBatch.selectedSeason,window);
        const responses=[currentBatch],errors=[];
        for(const year of years.slice(1)){
          try{responses.push(await requestSeason(game,year));}
          catch(error){errors.push(year+": "+String(error.message).slice(0,100));}
        }
        // Only recent CURRENT-season players are candidates for this game.
        // Prioritize up to four players per team for a single game (two for
        // multi-game scans); the user can explicitly expand coverage.
        const candidates=eligibleCareerPlayers(currentBatch,sport,
          window===3?(chosen.length>1?2:4):0);
        const state={game,responses,years,careerBatches:[],
          candidateCount:window===3?candidates.total:0,pendingPlayers:window===3?candidates.remaining:[],
          errors};
        states.push(state);
        if(window===3&&candidates.prioritized.length){
          scanProgress.textContent="Checking previous-team career history for "+title+"…";
          const careers=await careerPool(state,candidates.prioritized,years);
          state.careerBatches.push(...careers.output);
          state.errors.push(...careers.errors);
        }
      }catch(error){
        failures.push(title+": "+String(error.message).slice(0,150));
      }finally{
        completed++;
        scanProgress.textContent="Selected games analyzed: "+completed+"/"+chosen.length+
          " · Cross-team career lookups completed: "+careerBatchesDone;
      }
    }
  }
  try{
    await Promise.all(Array.from({length:Math.min(2,chosen.length)},()=>worker()));
    await render();
    scanProgress.textContent="Scan complete: "+completed+" games · "+
      (window===3?"Three-season positional-defense career research":"Current-season research")+
      " · "+careerBatchesDone+" individual historical lookups.";
  }finally{
    scanBtn.disabled=false;scanBtn.textContent="⚡ Scan Selected Games";
  }
});
