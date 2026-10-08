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
      // For pitcher-strikeout props, the opposing lineup\'s batting strikeouts
      // measure how often those hitters strike out, NOT positional defense.
      applyStat(out,"battingStrikeouts",numberAt(map,"SO","K"));
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
        const prev=result.get(id)||{id,name,headshot:athlete.headshot?.href||null,position:athlete.position?.abbreviation||athlete.position?.name||row.position?.abbreviation||row.position?.name||"",stats:{}};
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
      id:String(e.id),date:e.date,season:e.season?.year??null,
      opponentId:String(opp.team?.id||opp.id),
      opponent:opp.team?.displayName||opp.team?.name||"Opponent",
      teams
    }];
  });
  return entries.sort((a,b)=>Date.parse(b.date)-Date.parse(a.date)).slice(0,limit);
}
/**
 * Define the real role/position being defended for a particular prop.
 * For MLB, these are pitcher-vs-batter matchup units, not defensive positions.
 * Missing or ambiguous position => no comparable-defense claim.
 */
export function matchupRole(sport,position,stat){
  const pos=String(position||"").trim().toUpperCase();
  const market=CONFIG[sport]?.markets?.find(item=>item[0]===stat)?.[1]||stat;
  if(sport==="nfl"||sport==="ncaaf"){
    let role=null;
    if(["QB","QUARTERBACK"].includes(pos))role="QB";
    else if(["RB","HB","FB","RUNNING BACK","FULLBACK"].includes(pos))role="RB";
    else if(["WR","WIDE RECEIVER"].includes(pos))role="WR";
    else if(["TE","TIGHT END"].includes(pos))role="TE";
    if(!role)return null;
    return {role,label:role,metricLabel:role+" "+market.toLowerCase()+" allowed/game"};
  }
  if(sport==="nba"||sport==="ncaab"){
    const labels={
      PG:"Point guards",SG:"Shooting guards",SF:"Small forwards",
      PF:"Power forwards",C:"Centers",G:"Guards (unspecified)",
      F:"Forwards (unspecified)"
    };
    const map={
      PG:"PG","POINT GUARD":"PG",
      SG:"SG","SHOOTING GUARD":"SG",
      SF:"SF","SMALL FORWARD":"SF",
      PF:"PF","POWER FORWARD":"PF",
      C:"C","CENTER":"C",
      G:"G","GUARD":"G",
      F:"F","FORWARD":"F"
    };
    const role=map[pos];
    if(!role)return null;
    return {role,label:labels[role],metricLabel:labels[role]+" "+market.toLowerCase()+" allowed/game"};
  }
  if(sport==="soccer"){
    const role=["F","FW","ST","CF","LW","RW","FORWARD","STRIKER","WINGER"].includes(pos)?"F":
      ["M","MF","CM","CDM","CAM","LM","RM","MIDFIELDER"].includes(pos)?"M":
      ["D","DF","CB","LB","RB","LWB","RWB","DEFENDER"].includes(pos)?"D":
      ["GK","G","GOALKEEPER"].includes(pos)?"GK":null;
    if(!role)return null;
    return {role,label:role==="F"?"Forwards":role==="M"?"Midfielders":role==="D"?"Defenders":"Goalkeepers",
      metricLabel:(role==="F"?"Forwards":role==="M"?"Midfielders":role==="D"?"Defenders":"Goalkeepers")+" "+market.toLowerCase()+" allowed/game"};
  }
  if(sport==="mlb"){
    if(stat==="pitcherKs")return {role:"LINEUP",label:"Opposing batting lineup",
      metricLabel:"Opposing lineup strikeouts/game"};
    if(["hits","totalBases","runs","rbis","walks"].includes(stat))
      return {role:"BATTERS",label:"Opposing pitching staff",
        metricLabel:"Pitching staff "+market.toLowerCase()+" allowed/game"};
  }
  return null;
}
const profileKey=(stat,role)=>stat+"|"+role;

/**
 * Aggregate a single completed game: how much of a given statistic did an
 * actual defense allow to the opposition's specified position group?
 *
 * NBA G/F groups are broader than PG/SG/SF/PF. NFL WR/TE/RB remain separate.
 * Do NOT silently ignore a contributor whose positive stat lacks a position:
 * the aggregate would otherwise understate what the defense conceded.
 */
export function positionAllowedByGame(summary,sport,defenseTeamId){
  const groups=summary?.boxscore?.players;
  if(!Array.isArray(groups)||groups.length!==2)return {};
  const defense=groups.find(t=>String(t?.team?.id||"")===String(defenseTeamId));
  const offense=groups.find(t=>String(t?.team?.id||"")!==String(defenseTeamId));
  if(!defense||!offense||!offense.team?.id)return {};
  const teamId=String(offense.team.id);
  const offenders=extractBoxscore(summary,sport,teamId);
  const result={};
  const tainted=new Set();
  const markets=CONFIG[sport]?.markets||[];
  for(const athlete of offenders){
    for(const [stat] of markets){
      if(stat==="pitcherKs"&&sport==="mlb")continue;
      const value=athlete.stats[stat];
      if(!Number.isFinite(value)||value<0)continue;
      const info=matchupRole(sport,athlete.position,stat);
      if(!info){
        // A real, positive but uncategorized contribution invalidates any
        // positional total for this stat in this game.
        if(value>0)tainted.add(stat);
        continue;
      }
      const key=profileKey(stat,info.role);
      if(!result[key]) result[key]={value:0,stat,role:info.role,positionLabel:info.label,metricLabel:info.metricLabel,athletes:0};
      result[key].value+=value;
      result[key].athletes++;
    }
  }
  for(const [key,item] of Object.entries(result)){
    if(tainted.has(item.stat))delete result[key];
  }
  if(sport==="mlb"){
    // Pitcher Ks depends on how frequently the UPCOMING opponent's batters
    // strike out, not how many Ks the opposite team's pitchers record.
    const batters=extractBoxscore(summary,sport,String(defenseTeamId));
    const ks=batters.filter(p=>Number.isFinite(p.stats.battingStrikeouts))
      .map(p=>p.stats.battingStrikeouts);
    if(ks.length){
      const info=matchupRole("mlb","P","pitcherKs");
      result[profileKey("pitcherKs",info.role)]={
        value:ks.reduce((a,b)=>a+b,0),stat:"pitcherKs",role:info.role,
        positionLabel:info.label,metricLabel:info.metricLabel,athletes:ks.length
      };
    }
  }
  return result;
}

/**
 * Average position-specific concessions across completed games that occurred
 * strictly before the historical matchup. >=2 valid records are required.
 */
export function buildPositionProfile(games,sport,defenseTeamId,minSamples=2){
  const byKey=new Map();
  const seen=new Set();
  for(const game of games){
    if(!game?.id||seen.has(String(game.id))||!game.summary)continue;
    seen.add(String(game.id));
    const metrics=positionAllowedByGame(game.summary,sport,defenseTeamId);
    for(const [key,item] of Object.entries(metrics)){
      const values=byKey.get(key)||{values:[],positionLabel:item.positionLabel,metricLabel:item.metricLabel};
      values.values.push(item.value);
      byKey.set(key,values);
    }
  }
  const profiles={};
  for(const [key,item] of byKey){
    if(item.values.length<minSamples)continue;
    const mean=item.values.reduce((a,b)=>a+b,0)/item.values.length;
    profiles[key]={average:Math.round(mean*100)/100,games:item.values.length,
      positionLabel:item.positionLabel,metricLabel:item.metricLabel};
  }
  return profiles;
}

export function scanTrends(records,team,game,defenseProfiles,mode="similar",minSample=3){
  const markets=CONFIG[game.sport]?.markets||[];
  const grouped=new Map();
  for(const record of records){
    for(const athlete of record.players||[]){
      for(const [stat,label,minValue] of markets){
        const value=athlete.stats?.[stat];
        if(!Number.isFinite(value)||value<0)continue;
        const key=athlete.id+":"+stat;
        const entry=grouped.get(key)||{
          name:athlete.name,id:athlete.id,position:athlete.position||"",
          headshot:athlete.headshot,stat,label,minValue,history:[]
        };
        if(!entry.position && athlete.position)entry.position=athlete.position;
        entry.history.push({
          gameId:record.id,date:record.date,season:record.season??null,
          opponent:record.opponent,opponentId:record.opponentId,value
        });
        grouped.set(key,entry);
      }
    }
  }
  const picks=[];
  for(const entry of grouped.values()){
    const role=matchupRole(game.sport,entry.position,entry.stat);
    const metricKey=role?profileKey(entry.stat,role.role):null;
    const targetProfile=metricKey?defenseProfiles?.[team.targetOpponentId]?.target?.[metricKey]:null;
    const chronological=entry.history.sort((a,b)=>Date.parse(b.date)-Date.parse(a.date));
    const recent=chronological.slice(0,5);
    const decorated=chronological.map(g=>{
      const hist=metricKey?defenseProfiles?.[g.opponentId]?.[g.gameId]?.[metricKey]:null;
      return {...g,opponentAllowed:hist?.average??null,opponentDefenseGames:hist?.games??0};
    });
    // Compare market- and position-specific defense performance; never use
    // whole-team scoring averages as a substitute.
    const similar=decorated.filter(g=>{
      const target=targetProfile?.average;
      return Number.isFinite(target)&&target>0&&targetProfile.games>=2 &&
        Number.isFinite(g.opponentAllowed)&&g.opponentDefenseGames>=2 &&
        Math.abs(g.opponentAllowed-target)/target<=0.25;
    }).slice(0,4);
    const comparable=mode==="similar"?similar:recent;
    if(recent.length<4||comparable.length<minSample)continue;
    const floor=Math.min(...comparable.map(g=>g.value));
    const line=Math.round((floor-0.5)*2)/2;
    if(line<entry.minValue-0.5||line<0.5)continue;
    const hits=comparable.filter(g=>g.value>line).length;
    if(hits!==comparable.length)continue;
    const label=role?.positionLabel??role?.label??null;
    const metricLabel=targetProfile?.metricLabel??role?.metricLabel??null;
    picks.push({
      playerId:entry.id,player:entry.name,position:entry.position,
      headshot:entry.headshot,teamId:team.id,teamName:team.name,
      opponentId:team.targetOpponentId,market:entry.label,stat:entry.stat,
      line,marketSource:"Research threshold — NOT a PrizePicks/sportsbook line",
      matched:hits,sample:comparable.length,
      recentHits:recent.filter(g=>g.value>line).length,recentSample:recent.length,
      similarHits:similar.filter(g=>g.value>line).length,
      similarSample:similar.length,similarTarget:4,
      targetDefense:targetProfile?.average??null,
      targetDefenseGames:targetProfile?.games??0,
      matchupPosition:label,matchupMetric:metricLabel,
      history:recent,similarGames:similar,qualifyingGames:comparable,
      matchedSeasons:[...new Set(comparable.map(g=>g.season)
        .filter(s=>Number.isInteger(Number(s))&&s!==null).map(Number))].sort((a,b)=>b-a),
      reason:mode==="similar"
        ?"Opponent "+metricLabel+" is within 25% of upcoming opponent's rate, measured before each game"
        :"Last five recorded appearances; not filtered for comparable positional defense",
      scanMode:mode,gameId:game.id,gameDate:game.date
    });
  }
  return picks.sort((a,b)=>b.sample-a.sample||b.recentHits-a.recentHits||b.line-a.line);
}
