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
