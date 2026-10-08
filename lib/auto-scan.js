/**
 * Matchup Nightmare V2 — real-data OVER threshold scanner.
 * This is HISTORICAL research; a perfect sample is never a probability.
 * Our provisional provider is ESPN's undocumented public scoreboard/boxscore.
 */
export const CONFIG = {
  nfl: { path:"football/nfl", markets:[
    ["passingYards","Passing yards",100],["passCompletions","Completions",8],
    ["passAttempts","Pass attempts",12],["rushingYards","Rushing yards",10],
    ["rushAttempts","Rushing attempts",4],["receptions","Receptions",1],
    ["receivingYards","Receiving yards",10],["targets","Targets",2]
  ]},
  nba: {path:"basketball/nba",markets:[
    ["points","Points",8],["rebounds","Rebounds",2],["assists","Assists",2],
    ["threes","3-pointers made",1],["pra","PRA",14],["steals","Steals",1],["blocks","Blocks",1]
  ]},
  mlb: {path:"baseball/mlb",markets:[
    ["hits","Hits",1],["totalBases","Total bases",1],["runs","Runs",1],
    ["rbis","RBIs",1],["pitcherKs","Pitcher strikeouts",2],["walks","Walks",1]
  ]},
  ncaaf: {path:"football/college-football", markets:[
    ["passingYards","Passing yards",100],["passCompletions","Completions",8],
    ["rushingYards","Rushing yards",10],["receivingYards","Receiving yards",10],
    ["receptions","Receptions",1]
  ]},
  ncaab: {path:"basketball/mens-college-basketball",markets:[
    ["points","Points",7],["rebounds","Rebounds",2],["assists","Assists",2],
    ["threes","3-pointers made",1],["pra","PRA",12]
  ]},
  soccer: {path:"soccer/eng.1",markets:[
    ["shots","Shots",1],["shotsOnTarget","Shots on target",1],
    ["goals","Goals",1],["assists","Assists",1],["saves","Saves",1]
  ]}
};
export const SOCCER_LEAGUES = new Set(["eng.1","esp.1","ger.1","ita.1","fra.1","usa.1","uefa.champions"]);
const asNum = v => {
  if(typeof v==="number") return Number.isFinite(v)?v:null;
  if(typeof v!=="string" || !v.trim()) return null;
  const cleaned=v.trim().replaceAll(",","");
  if(!/^-?\d+(?:\.\d+)?$/.test(cleaned)) return null;
  const n=Number(cleaned);
  return Number.isFinite(n)?n:null;
};
const numberAt=(map,...names)=>{
  for(const name of names){
    const n=asNum(map[name]);
    if(n!==null) return n;
  }
  return null;
};
function madeAt(map,...names){
  for(const name of names){
    const raw=map[name];
    if(raw===undefined || raw===null)continue;
    const made=asNum(String(raw).split("-")[0]);
    if(made!==null) return made;
  }
  return null;
}
function applyStat(out,key,n){if(n!==null && Number.isFinite(n) && n>=0)out[key]=n;}
function makeMap(labels,stats){
  if(!Array.isArray(labels)||!Array.isArray(stats)||labels.length!==stats.length) return null;
  return Object.fromEntries(labels.map((label,i)=>[String(label).toUpperCase().replace(/\s/g,""),stats[i]]));
}
function assignCategory(sport,group,map,out){
  const cat=String(group||"").toLowerCase();
  if(sport==="nfl"||sport==="ncaaf"){
    if(cat.includes("passing")){
      applyStat(out,"passingYards",numberAt(map,"YDS"));
      const ca=map["C/ATT"]??map["COMP/ATT"]??map["CMP/ATT"];
      if(typeof ca==="string" && /^\d+\/\d+$/.test(ca)){
        applyStat(out,"passCompletions",Number(ca.split("/")[0]));
        applyStat(out,"passAttempts",Number(ca.split("/")[1]));
      }else{
        applyStat(out,"passCompletions",numberAt(map,"CMP","COMP"));
        applyStat(out,"passAttempts",numberAt(map,"ATT"));
      }
    }
    if(cat.includes("rushing")){
      applyStat(out,"rushingYards",numberAt(map,"YDS"));
      applyStat(out,"rushAttempts",numberAt(map,"CAR","ATT"));
    }
    if(cat.includes("receiving")){
      applyStat(out,"receivingYards",numberAt(map,"YDS"));
      applyStat(out,"receptions",numberAt(map,"REC"));
      applyStat(out,"targets",numberAt(map,"TGTS","TGT","TARGETS"));
    }
  } else if(sport==="nba"||sport==="ncaab"){
    applyStat(out,"points",numberAt(map,"PTS"));
    applyStat(out,"rebounds",numberAt(map,"REB"));
    applyStat(out,"assists",numberAt(map,"AST"));
    applyStat(out,"threes",madeAt(map,"3PT","3P","3-PT"));
    applyStat(out,"steals",numberAt(map,"STL"));
    applyStat(out,"blocks",numberAt(map,"BLK"));
  } else if(sport==="mlb"){
    if(cat.includes("bat")){
      applyStat(out,"hits",numberAt(map,"H"));
      applyStat(out,"runs",numberAt(map,"R"));
      applyStat(out,"rbis",numberAt(map,"RBI"));
      applyStat(out,"walks",numberAt(map,"BB"));
      // Total bases from aggregate singles/doubles/triples/HR is not available
      // in many boxscore schemas. Do not fabricate it from hits.
      const doubles=numberAt(map,"2B"),triples=numberAt(map,"3B"),hr=numberAt(map,"HR"),hits=numberAt(map,"H");
      if([doubles,triples,hr,hits].every(v=>v!==null) && hits>=doubles+triples+hr) {
        applyStat(out,"totalBases",hits+doubles+2*triples+3*hr);
      }
    }else if(cat.includes("pitch")){
      applyStat(out,"pitcherKs",numberAt(map,"K","SO"));
    }
  } else if(sport==="soccer"){
    applyStat(out,"shots",numberAt(map,"SH","SHOTS"));
    applyStat(out,"shotsOnTarget",numberAt(map,"SOG","SOT"));
    applyStat(out,"goals",numberAt(map,"G","GLS","GOALS"));
    applyStat(out,"assists",numberAt(map,"A","AST","ASSISTS"));
    applyStat(out,"saves",numberAt(map,"SV","SAVES"));
  }
}
/**
 * Parse common ESPN summary: boxscore.players[team].statistics[category].athletes.
 * Intentionally omit missing/unparseable values; do not turn missing stats into 0.
 */
export function extractBoxscore(summary,sport,teamId){
  const groups=summary?.boxscore?.players;
  if(!Array.isArray(groups)) return [];
  const result=new Map();
  for(const team of groups){
    if(String(team?.team?.id||"")!==String(teamId)) continue;
    for(const group of team.statistics||[]){
      const labels=group?.labels||[];
      for(const row of group.athletes||[]){
        const athlete=row.athlete||{};
        const id=String(athlete.id||"");
        const name=athlete.displayName||athlete.fullName;
        if(!id||!name||row.didNotPlay||row.athlete?.didNotPlay||row.stats===null) continue;
        const map=makeMap(labels,row.stats);
        if(!map)continue;
        const prev=result.get(id)||{id,name,headshot:athlete.headshot?.href||null,position:athlete.position?.abbreviation||"",stats:{}};
        assignCategory(sport,group.name||group.displayName,map,prev.stats);
        result.set(id,prev);
      }
    }
  }
  if(sport==="nba"||sport==="ncaab"){
    for(const p of result.values()){
      const {points,rebounds,assists}=p.stats;
      if([points,rebounds,assists].every(Number.isFinite))p.stats.pra=points+rebounds+assists;
    }
  }
  return [...result.values()].filter(p=>Object.keys(p.stats).length>0);
}
/** Returns only completed games that happened BEFORE the selected game. */
export function priorGames(schedule,teamId,beforeDate,limit=7){
  const entries=(schedule?.events||[]).flatMap(e=>{
    const c=e?.competitions?.[0],teams=c?.competitors||[];
    if(!teams.some(t=>String(t?.team?.id||t?.id)===String(teamId)))return [];
    const finished=e?.status?.type?.completed===true||e?.status?.type?.state==="post"||c?.status?.type?.completed===true||c?.status?.type?.state==="post";
    if(!finished || !e.date || !Number.isFinite(Date.parse(e.date)) || !(Date.parse(e.date)<Date.parse(beforeDate)))return [];
    const opp=teams.find(t=>String(t?.team?.id||t?.id)!==String(teamId));
    if(!opp?.team?.id&&!opp?.id)return [];
    return [{
      id:String(e.id),date:e.date,
      opponentId:String(opp.team?.id||opp.id),
      opponent:opp.team?.displayName||opp.team?.name||"Opponent",
      teams
    }];
  });
  return entries.sort((a,b)=>Date.parse(b.date)-Date.parse(a.date)).slice(0,limit);
}
export function defensiveAverage(schedule,defensiveTeamId,asOf,minGames=3){
  const games=priorGames(schedule,defensiveTeamId,asOf,12);
  const points=[];
  for(const g of games){
    const opponent=g.teams.find(t=>String(t.team?.id||t.id)!==String(defensiveTeamId));
    const allowed=asNum(opponent?.score?.value??opponent?.score);
    if(allowed!==null && allowed>=0)points.push(allowed);
    if(points.length===5)break;
  }
  return points.length>=minGames?points.reduce((a,b)=>a+b,0)/points.length:null;
}
export function scanTrends(records,team,game,defenseProfiles,mode="similar",minSample=3){
  const markets=CONFIG[game.sport]?.markets||[];
  const grouped=new Map();
  for(const record of records){
    for(const athlete of record.players){
      for(const [stat,label,minValue] of markets){
        const value=athlete.stats[stat];
        if(!Number.isFinite(value)||value<0)continue;
        const key=athlete.id+":"+stat;
        const entries=grouped.get(key)||{name:athlete.name,id:athlete.id,position:athlete.position,headshot:athlete.headshot,stat,label,minValue,team,history:[]};
        entries.history.push({
          gameId:record.id,date:record.date,opponent:record.opponent,value,
          defenseAverage:defenseProfiles[record.opponentId]?.[record.id]??null
        });
        grouped.set(key,entries);
      }
    }
  }
  const targetDefense=defenseProfiles[team.targetOpponentId]?.target??null;
  const picks=[];
  for(const entry of grouped.values()){
    // First sort ALL fetched appearances by date. Comparable games may be older than
    // the last five, so don't accidentally restrict opponent-matching to recent games.
    const chronological=entry.history.sort((a,b)=>Date.parse(b.date)-Date.parse(a.date));
    const recent=chronological.slice(0,5);
    // This is a preliminary TEAM scoring-defense comparison, not position-specific.
    // Take the four MOST RECENT qualifying opponents rather than choosing by results.
    const similar=chronological.filter(r=>Number.isFinite(targetDefense) && targetDefense>0 &&
      Number.isFinite(r.defenseAverage)&&Math.abs(r.defenseAverage-targetDefense)/targetDefense<=0.30).slice(0,4);
    const comparable=mode==="similar"?similar:recent;
    if(recent.length<4||comparable.length<minSample)continue;
    const floor=Math.min(...comparable.map(g=>g.value));
    const line=floor-0.5;
    if(line<entry.minValue-0.5 || line<0.5)continue;
    const hits=comparable.filter(g=>g.value>line).length;
    if(hits!==comparable.length)continue;
    picks.push({
      playerId:entry.id,player:entry.name,position:entry.position,
      headshot:entry.headshot,teamId:team.id,teamName:team.name,
      opponentId:team.targetOpponentId,market:entry.label,stat:entry.stat,
      line:Math.round(line*2)/2,marketSource:"Research threshold — NOT a PrizePicks/ sportsbook line",
      matched:hits,sample:comparable.length,
      recentHits:recent.filter(g=>g.value>line).length,recentSample:recent.length,
      similarHits:similar.filter(g=>g.value>line).length,
      similarSample:similar.length,targetDefense:targetDefense,
      // Send identical four-game evidence to all sports, including recent-only cards.
      similarGames:similar,similarTarget:4,
      history:recent,qualifyingGames:comparable,
      reason:mode==="similar"?"Team scoring defense within 30% of upcoming opponent (before each game)":"Last five recorded appearances; not matchup filtered",
      scanMode:mode,
      gameId:game.id,gameDate:game.date
    });
  }
  return picks.sort((a,b)=>b.sample-a.sample||b.recentHits-a.recentHits||b.line-a.line);
}
