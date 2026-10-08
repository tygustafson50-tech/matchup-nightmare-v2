import {analyze,parseLogs} from "/lib/engine.js";
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
function central(iso){try{return new Intl.DateTimeFormat("en-US",{timeZone:"America/Chicago",month:"short",day:"numeric",hour:"numeric",minute:"2-digit",timeZoneName:"short"}).format(new Date(iso));}catch{return "Time unavailable";}}
function chooseSport(s){current=s;selected.clear();el("sports").querySelectorAll("button").forEach(b=>b.classList.toggle("active",b.dataset.s===s));el("market").innerHTML=sports[s].markets.map(m=>'<option>'+safe(m)+'</option>').join("");el("leagueWrap").hidden=s!=="soccer";loadGames();}
function drawGames(){el("count").textContent=selected.size+" / 16 games selected";el("games").innerHTML=games.length?games.map(g=>'<button class="game '+(selected.has(g.id)?"active":"")+'" data-id="'+safe(g.id)+'" aria-pressed="'+selected.has(g.id)+'">'+(g.away.logo?'<img alt="" src="'+safe(g.away.logo)+'">':"")+'<div>'+safe(g.away.name)+' @ '+safe(g.home.name)+'<small>'+central(g.date)+' · '+safe(g.status)+'</small></div>'+(g.home.logo?'<img alt="" src="'+safe(g.home.logo)+'">':"")+'<b>'+(selected.has(g.id)?"✓":"+")+'</b></button>').join(""):'<div class="empty">No games returned. Try another date.</div>';
el("games").querySelectorAll("button").forEach(b=>b.addEventListener("click",()=>{if(selected.has(b.dataset.id))selected.delete(b.dataset.id);else if(selected.size<16)selected.add(b.dataset.id);else return alert("Maximum 16 games");drawGames();}));}
async function loadGames(){games=[];selected.clear();el("games").innerHTML="";el("scheduleStatus").textContent="Loading real schedules…";let url="/api/games?sport="+current+"&date="+encodeURIComponent(el("date").value);if(current==="soccer")url+="&league="+encodeURIComponent(el("league").value);
try{const r=await fetch(url),data=await r.json();if(!r.ok)throw Error(data.details||data.error);games=data.games||[];el("scheduleStatus").textContent=games.length+" scheduled games · "+data.source;drawGames();}catch(e){el("scheduleStatus").textContent="Schedule unavailable: "+e.message;drawGames();}}
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
const defense=el("defense").value.trim()?Number(el("defense").value):NaN;if(Number.isFinite(defense)&&defense<=0)throw Error("Team scoring allowed must be positive.");
const result=analyze(logs,line,defense);if(el("perfect").checked&&!result.historical100){el("output").innerHTML='<div class="empty">No 100% comparable trend with a minimum of three valid comparable games.</div>';return;}
const max=Math.max(1,line*1.2,...result.recent.map(g=>g.value));
el("output").innerHTML='<h2>'+safe(name)+' — OVER '+line+' '+safe(market)+'</h2><p class="muted">User-entered statistics only. Games selected: '+selected.size+'. Selecting games does not automatically populate players or verified markets.</p>'+
(bad.length?'<p class="error">Invalid input lines ignored: '+bad.join(", ")+'</p>':"")+
'<div class="metrics">'+metric("Last 5",result.last5)+metric("Last 10",result.last10)+metric("All supplied",result.season)+metric("Similar scoring defense",result.similar)+'</div>'+
'<h3>Recent games</h3><div class="chart">'+result.recent.slice().reverse().map(g=>'<div class="bar '+(g.value>line?"hit":"")+'" style="height:'+Math.max(3,100*g.value/max)+'%" title="'+safe(g.date+" "+g.opponent+" "+g.value)+'"></div>').join("")+'</div>'+
result.recent.map(g=>'<div class="history"><span>'+safe(g.date)+'</span><span>'+safe(g.opponent)+'</span><b>'+g.value+'</b></div>').join("")+
'<h3>Similar team scoring defenses</h3><p class="muted">Compares manually supplied opponent team scoring allowed within 20%. This is not defense-versus-position.</p>'+
(result.similarGames.length?result.similarGames.map(g=>'<div class="history"><span>'+safe(g.date)+'</span><span>'+safe(g.opponent)+' (defense: '+g.allowed+')</span><b>'+g.value+'</b></div>').join(""):'<p class="muted">Not enough valid defensive comparison data.</p>')+
'<div class="warning">Historical hit rates do not guarantee wins. No live sportsbook lines, verified player logs, injuries, or calibrated prediction model are connected.</div>';
}catch(e){el("output").innerHTML='<p class="error">'+safe(e.message)+'</p>';}
});
chooseSport("nfl");


/* Automatic scan of selected matchups. Manual research above remains optional. */
const scanBtn=el("scanSelected");
const scanProgress=el("scanProgress");
function clearAutomaticResearch(){
  el("scanOutput").innerHTML='<div class="empty">Select your games and click Scan Selected Games.</div>';
}
function renderAutomaticResults(items,failures,completed){
  if(!items.length){
    el("scanOutput").innerHTML=
      '<div class="empty">No 100% qualifying OVER thresholds returned from the available completed-game history.<p class="muted">This could mean no qualified matches, fewer than 3 comparable opponents, missing source boxscores, or unavailable scoring-defense data. Try switching to Recent completed games for a broader historical scan. Nothing is guaranteed.</p></div>'+
      failures.map(e=>'<p class="error">'+safe(e)+'</p>').join("");
    return;
  }
  const all=items.flatMap(x=>x.results.map(p=>({...p,sourceGame:x.game,provider:x.provider})))
    .sort((a,b)=>(a.scanMode==="similar"?0:1)-(b.scanMode==="similar"?0:1)||b.sample-a.sample || b.recentHits-a.recentHits || b.line-a.line);
  const cards=all.slice(0,100).map(p=>{
    const recentRatio=p.recentSample?p.recentHits+'/'+p.recentSample:'—';
    const photo=p.headshot
      ?'<img class="player-image" src="'+safe(p.headshot)+'" alt="" loading="lazy" onerror="this.hidden=true">'
      :'<div class="player-initial">'+safe(p.player.split(" ").map(x=>x[0]).slice(0,2).join(""))+'</div>';
    const qualifying=(p.qualifyingGames||[]).map(g=>'<div class="history"><span>'+safe(g.date?.slice(0,10))+'</span><span>'+safe(g.opponent)+'</span><b>'+g.value+'</b></div>').join("");
    const recent=(p.history||[]).map(g=>'<div class="history"><span>'+safe(g.date?.slice(0,10))+'</span><span>'+safe(g.opponent)+'</span><b class="'+(g.value>p.line?'gold-value':'')+'">'+g.value+'</b></div>').join("");
    const defense=Number.isFinite(p.targetDefense)?p.targetDefense.toFixed(1):"Unavailable";
    return '<article class="scan-card">'+
      '<div class="scan-top"><div class="scan-identity">'+photo+'<div><strong>'+safe(p.player)+'</strong><small>'+safe(p.teamName)+' · '+safe(p.sourceGame?.away?.name)+' @ '+safe(p.sourceGame?.home?.name)+'</small><small>'+safe(p.position||"Player")+'</small></div></div><span class="trend-badge">100% '+(p.scanMode==="similar"?"SIMILAR":"RECENT")+' · '+p.matched+'/'+p.sample+'</span></div>'+
      '<div class="scan-line">RESEARCH OVER <strong>'+p.line+'</strong> '+safe(p.market)+'</div>'+
      '<div class="scan-stats"><div><strong>'+p.matched+'/'+p.sample+'</strong><small>Qualifying history</small></div><div><strong>'+recentRatio+'</strong><small>Last '+p.recentSample+' OVER</small></div><div><strong>'+defense+'</strong><small>Opponent scoring allowed</small></div></div>'+
      '<p class="muted">'+safe(p.reason)+'. Every qualifying recorded game exceeded the displayed threshold.</p>'+
      '<div class="research-label">CALCULATED ALT THRESHOLD • NOT A VERIFIED PRIZEPICKS / SPORTSBOOK OFFER</div>'+
      '<details><summary>Show the actual historical games</summary><h4>100% qualifying sample</h4>'+qualifying+'<h4>Most recent player appearances</h4>'+recent+'</details></article>';
  }).join("");
  const message=all.length>100?'<p class="muted">Showing the first 100 of '+all.length+' results.</p>':"";
  el("scanOutput").innerHTML='<p class="muted">Scanned '+completed+' selected matchup(s). Found '+all.length+' historical 100% research thresholds. These are not live PrizePicks lines, quoted odds, or guaranteed outcomes.</p>'+
    (failures.length?'<div class="warning">'+safe(failures.length)+' games or partial data sources could not be analyzed. '+failures.slice(0,5).map(safe).join(" · ")+'</div>':"")+
    message+'<div class="scan-grid">'+cards+'</div>';
}
scanBtn.addEventListener("click",async()=>{
  const chosen=games.filter(g=>selected.has(g.id));
  if(!chosen.length){
    scanProgress.textContent="Select at least one matchup first.";
    el("scanOutput").innerHTML='<div class="empty">Select one or more games, then press Scan Selected Games.</div>';
    return;
  }
  const sport=current;
  const date=el("date").value;
  const league=el("league").value;
  const mode=el("scanMode").value;
  const batches=[],failures=[];
  let completed=0,cursor=0;
  scanBtn.disabled=true;scanBtn.textContent="Scanning…";
  el("scanOutput").innerHTML='<div class="empty">Fetching completed-game boxscores for the selected teams. This can take a little time, especially for several games. Results are never invented.</div>';
  scanProgress.textContent="Scanning 0 of "+chosen.length+" selected games…";
  async function worker(){
    while(cursor<chosen.length){
      const idx=cursor++;
      const item=chosen[idx];
      const q=new URLSearchParams({sport,date,gameId:item.id,mode});
      if(sport==="soccer")q.set("league",league);
      try{
        const response=await fetch("/api/scan?"+q);
        const body=await response.json();
        if(!response.ok)throw Error(body.details||body.error||"Data source unavailable");
        batches.push(body);
        if(body.diagnostics?.boxscoreFailures||body.diagnostics?.defenseFailures){
          failures.push(safe(item.away.name+" @ "+item.home.name)+": incomplete historical feeds.");
        }
      }catch(error){
        failures.push(item.away.name+" @ "+item.home.name+": "+String(error.message).slice(0,130));
      }finally{
        completed++;
        scanProgress.textContent="Scanned "+completed+" of "+chosen.length+" games · "+batches.reduce((n,b)=>n+(b.results?.length||0),0)+" historical 100% thresholds identified";
      }
    }
  }
  try{
    await Promise.all(Array.from({length:Math.min(2,chosen.length)},()=>worker()));
    if(sport!==current || date!==el("date").value)return;
    renderAutomaticResults(batches,failures,completed);
    scanProgress.textContent="Scan completed: "+completed+" games. "+batches.reduce((n,b)=>n+(b.results?.length||0),0)+" historical 100% thresholds found.";
  }finally{
    scanBtn.disabled=false;scanBtn.textContent="⚡ Scan Selected Games";
  }
});
