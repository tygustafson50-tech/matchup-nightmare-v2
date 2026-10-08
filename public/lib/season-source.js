/**
 * Browser-side player and defensive history aggregator.
 * Cloudflare /api/espn streams only one provider document per request.
 */
import {CONFIG,priorGames,extractBoxscore,buildPositionProfile,
  rosterPositionIndex,attachRosterPositions,matchupRole} from "./auto-scan.js";
import {parseApiResponse} from "./api-client.js";

const GOOD_ID=/^\d{1,15}$/;
const MAX_HISTORY=5,DEFENSE_CANDIDATES=3,PROFILE_GAMES=2;
export function seasonOf(game,sport){
  if(Number.isInteger(Number(game?.season))&&Number(game.season)>1900)
    return Number(game.season);
  const date=String(game?.date||"");
  if(!Number.isFinite(Date.parse(date)))return null;
  const year=Number(date.slice(0,4)),month=Number(date.slice(5,7));
  if(["nfl","ncaaf","soccer"].includes(sport)&&month<7)return year-1;
  if(["nba","ncaab"].includes(sport)&&month>=7)return year+1;
  return year;
}
function seasonRecord(g,year,sport){
  const actual=g.season!==null&&g.season!==undefined&&Number.isInteger(Number(g.season))
    ?Number(g.season):seasonOf(g,sport);
  return actual===year;
}
const errorText=err=>String(err?.message||err).slice(0,180);

export function createEspnSourceClient({request=globalThis.fetch,concurrency=3,
  onProgress=()=>{}}={}){
  const memo=new Map(),queue=[];
  let active=0,completed=0;
  const max=Math.max(1,Math.min(5,concurrency));
  const pump=()=>{
    while(active<max&&queue.length){
      const job=queue.shift();active++;
      Promise.resolve().then(job.task).then(job.resolve,job.reject).finally(()=>{
        completed++;active--;onProgress({completed,active,pending:queue.length});
        pump();
      });
    }
  };
  const limit=task=>new Promise((resolve,reject)=>{
    queue.push({task,resolve,reject});pump();
  });
  const source=params=>{
    const key=Object.keys(params).sort().map(k=>k+"="+params[k]).join("|");
    if(!memo.has(key)){
      memo.set(key,limit(async()=>{
        const url="/api/espn?"+new URLSearchParams(params);
        const response=await request(url,{headers:{Accept:"application/json"}});
        return parseApiResponse(response,"ESPN "+params.kind+
          (params.teamId?" team "+params.teamId:"")+
          (params.gameId?" game "+params.gameId:""));
      }));
    }
    return memo.get(key);
  };
  return {source,stats:()=>({completed,active,unique:memo.size})};
}

export async function loadSeasonFromEspn({
  client,sport,league="eng.1",game,season="current",onStage=()=>{}
}={}){
  if(!client||typeof client.source!=="function")throw Error("ESPN source client missing.");
  if(!CONFIG[sport])throw Error("Unsupported sport.");
  if(!GOOD_ID.test(String(game?.id))||!GOOD_ID.test(String(game?.home?.id))||
    !GOOD_ID.test(String(game?.away?.id))||!Number.isFinite(Date.parse(game?.date)))
    throw Error("Missing actual ESPN game/team IDs. Refresh the game schedule.");
  const selectedSeason=seasonOf(game,sport);
  const year=season==="current"?selectedSeason:Number(season);
  if(!Number.isInteger(year)||year<selectedSeason-2||year>selectedSeason)
    throw Error("Historical season not in the three-season window.");
  const common={sport,...(sport==="soccer"?{league}:{})};
  const teams=[{...game.home,id:String(game.home.id),homeAway:"home",
    targetOpponentId:String(game.away.id)},
    {...game.away,id:String(game.away.id),homeAway:"away",
    targetOpponentId:String(game.home.id)}];
  const diagnostics={upstreamRequests:0,offenseSchedules:0,offenseBoxscores:0,
    missingOffenseBoxscores:0,defenseSchedules:0,defenseBoxscores:0,
    missingDefenseBoxscores:0,defenseProfiles:0,rosterLookups:0,
    rosterLookupsSucceeded:0,rosterLookupsFailed:0,
    positionRowsResolved:0,positionRowsMissing:0,defenseProfileStatTypes:0};
  const notes=[],scheduleCache=new Map(),summaryCache=new Map();
  const schedule=id=>{
    const key=String(id);
    if(!scheduleCache.has(key))scheduleCache.set(key,client.source({
      ...common,kind:"schedule",teamId:key,season:String(year)
    }));
    return scheduleCache.get(key);
  };
  const summary=id=>{
    const key=String(id);
    if(!summaryCache.has(key))summaryCache.set(key,client.source({
      ...common,kind:"summary",gameId:key
    }));
    return summaryCache.get(key);
  };
  const completed=(document,id,before,limit=MAX_HISTORY)=>
    priorGames(document,id,before,180)
      .filter(g=>seasonRecord(g,year,sport)).slice(0,limit);
  onStage("Loading "+year+" verified team schedules…");
  const scheduleSettled=await Promise.allSettled(teams.map(t=>schedule(t.id)));
  const histories={},available=[];
  for(let i=0;i<teams.length;i++){
    const team=teams[i],outcome=scheduleSettled[i];
    if(outcome.status==="fulfilled"){
      diagnostics.offenseSchedules++;available.push(team.id);
      histories[team.id]=completed(outcome.value,team.id,game.date);
    }else{
      histories[team.id]=[];
      notes.push("ESPN "+year+" schedule unavailable for "+team.name+": "+
        errorText(outcome.reason));
    }
  }
  if(!available.length)throw Error(notes.join(" | "));
  const offense=[...new Map(Object.values(histories).flat()
    .map(g=>[String(g.id),g])).values()];
  onStage("Reading "+year+" recorded player statistics…");
  const boxscores=new Map();
  const offenseSettled=await Promise.allSettled(offense.map(g=>summary(g.id)));
  for(let i=0;i<offense.length;i++){
    const result=offenseSettled[i];
    if(result.status==="fulfilled"){
      boxscores.set(String(offense[i].id),result.value);
      diagnostics.offenseBoxscores++;
    }else{
      diagnostics.missingOffenseBoxscores++;
      notes.push("Boxscore "+offense[i].id+" unavailable: "+errorText(result.reason));
    }
  }
  const demands=[];
  for(const team of teams){
    if(!available.includes(team.id))continue;
    if(year===selectedSeason)
      demands.push({kind:"target",defenseId:team.targetOpponentId,
        eventId:null,before:game.date});
    for(const g of histories[team.id].slice(0,DEFENSE_CANDIDATES))
      demands.push({kind:"historical",defenseId:String(g.opponentId),
        eventId:String(g.id),before:g.date});
  }
  onStage("Checking "+year+" pregame defensive performance…");
  const opponentIds=[...new Set(demands.map(d=>d.defenseId)
    .filter(id=>!available.includes(id)))];
  const opponentSettled=await Promise.allSettled(opponentIds.map(id=>schedule(id)));
  for(let i=0;i<opponentIds.length;i++){
    if(opponentSettled[i].status==="fulfilled")diagnostics.defenseSchedules++;
    else notes.push("Defense "+opponentIds[i]+": "+errorText(opponentSettled[i].reason));
  }
  const validDemands=[],needBoxes=new Set();
  for(const d of demands){
    let source;
    try{source=await schedule(d.defenseId)}catch{continue;}
    const prior=completed(source,d.defenseId,d.before,PROFILE_GAMES);
    validDemands.push({...d,games:prior});
    for(const g of prior)if(!boxscores.has(String(g.id)))needBoxes.add(String(g.id));
  }
  const additional=[...needBoxes];
  const defenseSettled=await Promise.allSettled(additional.map(id=>summary(id)));
  for(let i=0;i<additional.length;i++){
    if(defenseSettled[i].status==="fulfilled"){
      boxscores.set(additional[i],defenseSettled[i].value);
      diagnostics.defenseBoxscores++;
    }else diagnostics.missingDefenseBoxscores++;
  }
  // Position labels in ESPN event boxscores are often missing.
  // Accept only an actual player/roster position, never infer one from stats.
  const rosterWanted=new Map();
  const addRoster=(id,priority)=>{
    const key=String(id);
    if(!GOOD_ID.test(key))return;
    const seen=rosterWanted.get(key);
    if(seen===undefined||priority<seen)rosterWanted.set(key,priority);
  };
  const lacksPosition=(raw,teamId)=>{
    if(sport==="mlb")return false;
    return extractBoxscore(raw,sport,teamId).some(p=>
      CONFIG[sport].markets.some(([stat])=>Number.isFinite(p.stats?.[stat])&&
        !matchupRole(sport,p.position,stat)));
  };
  for(const t of teams){
    if(histories[t.id].some(g=>boxscores.has(String(g.id))&&
        lacksPosition(boxscores.get(String(g.id)),t.id)))addRoster(t.id,0);
  }
  for(const d of validDemands)for(const g of d.games){
    const raw=boxscores.get(String(g.id));
    if(!raw)continue;
    for(const team of raw.boxscore?.players||[]){
      const id=String(team.team?.id||"");
      if(id!==d.defenseId&&lacksPosition(raw,id))
        addRoster(id,d.kind==="target"?1:2);
    }
  }
  const rosterIds=[...rosterWanted.entries()].sort((a,b)=>a[1]-b[1])
    .slice(0,8).map(x=>x[0]);
  const rosterSettled=await Promise.allSettled(rosterIds.map(teamId=>
    client.source({...common,kind:"roster",
      teamId,season:String(year)})));
  const verified={};
  for(let i=0;i<rosterIds.length;i++){
    diagnostics.rosterLookups++;
    if(rosterSettled[i].status==="fulfilled"){
      const map=rosterPositionIndex(rosterSettled[i].value,rosterIds[i]);
      if(Object.keys(map[rosterIds[i]]||{}).length){
        verified[rosterIds[i]]=map[rosterIds[i]];
        diagnostics.rosterLookupsSucceeded++;
      }else diagnostics.rosterLookupsFailed++;
    }else diagnostics.rosterLookupsFailed++;
  }
  for(const [id,raw] of boxscores)
    boxscores.set(id,attachRosterPositions(raw,verified));
  const profiles={};
  for(const d of validDemands){
    const prior=d.games.filter(g=>boxscores.has(String(g.id)))
      .map(g=>({id:String(g.id),summary:boxscores.get(String(g.id))}));
    const p=buildPositionProfile(prior,sport,d.defenseId,2);
    profiles[d.defenseId]??={};
    if(d.kind==="target")profiles[d.defenseId].target=p;
    else profiles[d.defenseId][d.eventId]=p;
    if(Object.keys(p).length){
      diagnostics.defenseProfiles++;
      diagnostics.defenseProfileStatTypes+=Object.keys(p).length;
    }
  }
  const records={};
  for(const team of teams){
    records[team.id]=histories[team.id].filter(g=>boxscores.has(String(g.id)))
      .map(g=>{
        const players=extractBoxscore(boxscores.get(String(g.id)),sport,team.id);
        for(const p of players){
          if(p.position)diagnostics.positionRowsResolved++;
          else diagnostics.positionRowsMissing++;
        }
        return {id:String(g.id),date:g.date,season:year,
          opponent:g.opponent,opponentId:String(g.opponentId),
          playedTeamId:team.id,playedTeamName:team.name,players};
      });
  }
  if(diagnostics.missingOffenseBoxscores||diagnostics.missingDefenseBoxscores)
    notes.push("Some missing ESPN boxscores were excluded, not replaced by zero.");
  if(rosterWanted.size>rosterIds.length)
    notes.push("Some historical position rosters were not sampled.");
  notes.push("Historical defensive profiles use only actual games played "+
    "before each past player matchup.");
  diagnostics.upstreamRequests=client.stats?.().unique??0;
  return {
    sport,league:sport==="soccer"?league:CONFIG[sport].path.split("/")[1],
    game:{id:String(game.id),date:game.date,home:teams[0],away:teams[1]},
    mode:"both",focusTeam:"browser",
    season:year,selectedSeason,isCurrentSeason:year===selectedSeason,
    count:0,results:[],seasonBatch:{season:year,teams,records,
      defenseProfiles:profiles},
    notes,diagnostics,
    provider:"ESPN original public game records (unofficial); browser-computed",
    fetchedAt:new Date().toISOString()
  };
}
