/**
 * Matchup Nightmare V3 ESPN evidence transport.
 * Reads source boxscores and pregame defender histories. It NEVER creates
 * lines, fills missing stats with zero, or calls the deleted prediction engine.
 * ESPN public endpoints are provisional: missing source => incomplete evidence.
 */
import {positionGroup,supportsMarket} from "./research-v3.js";
import {parseFootballDefenseRanks} from "./football-defense-ranks.js";
import {extractRosterVisuals} from "./player-profile-v3.js";
const safeNum=n=>{
  if(typeof n==="number")return Number.isFinite(n)?n:null;
  if(typeof n!=="string"||!n.trim())return null;
  const v=Number(n.trim().replace(/,/g,""));
  return Number.isFinite(v)?v:null;
};
const normalize=s=>String(s||"").normalize("NFKD").replace(/[\u0300-\u036f]/g,"")
  .toLowerCase().replace(/[^a-z0-9]/g,"");
const idOk=id=>/^\d{1,15}$/.test(String(id||""));
const nameOf=x=>x?.displayName||x?.fullName||x?.name||"";
const codeOf=x=>typeof x==="string"?x:
  x?.abbreviation||x?.shortDisplayName||x?.displayName||"";
function statsFrom(group,row,sport){
  const keys=(group.labels||[]).map(x=>String(x).toUpperCase().replace(/\s/g,""));
  const values=Array.isArray(row.stats)?row.stats:[];
  if(keys.length!==values.length)return {};
  const map=Object.fromEntries(keys.map((v,i)=>[v,values[i]]));
  const at=(...names)=>{for(const key of names){
    const v=safeNum(map[key]);if(v!==null)return v;
  }return null;};
  const made=(...names)=>{for(const key of names){
    const v=map[key];if(v===undefined)continue;
    const n=safeNum(String(v).split("-")[0]);if(n!==null)return n;
  }return null;};
  const out={};
  const put=(key,value)=>{if(value!==null&&value>=0)out[key]=value;};
  let cat=String(group.name||group.displayName||"").toLowerCase();
  if(sport==="mlb"&&!cat){
    // ESPN MLB summary box-score category often omits group.name. The
    // mutually distinct IP and AB column sets are authoritative evidence.
    cat=map.IP!==undefined?"pitching":
      map.AB!==undefined||map["H-AB"]!==undefined?"batting":"";
  }
  if(["nfl","ncaaf"].includes(sport)){
    if(cat.includes("passing")){
      put("passingYards",at("YDS"));put("passingTDs",at("TD","TDS"));
      const comp=map["C/ATT"]||map["CMP/ATT"]||map["COMP/ATT"];
      if(typeof comp==="string"&&/^\d+\/\d+$/.test(comp)){
        put("passCompletions",Number(comp.split("/")[0]));
        put("passAttempts",Number(comp.split("/")[1]));
      }else{put("passCompletions",at("CMP","COMP"));put("passAttempts",at("ATT"));}
    }else if(cat.includes("rushing")){
      put("rushingYards",at("YDS"));put("rushAttempts",at("CAR","ATT"));
      put("rushingTDs",at("TD","TDS"));
    }else if(cat.includes("receiving")){
      put("receivingYards",at("YDS"));put("receptions",at("REC"));
      put("targets",at("TGTS","TGT","TARGETS"));
      put("receivingTDs",at("TD","TDS"));
    }
  }else if(["nba","ncaab"].includes(sport)){
    put("points",at("PTS"));put("rebounds",at("REB"));put("assists",at("AST"));
    put("threes",made("3PT","3P","3-PT"));put("steals",at("STL"));put("blocks",at("BLK"));
    put("fieldGoalAttempts",at("FGA"));
    const fga=map["FG"]||map["FGM-A"];if(!("fieldGoalAttempts" in out)&&typeof fga==="string"&&/^\d+-\d+$/.test(fga))
      put("fieldGoalAttempts",Number(fga.split("-")[1]));
    if(["points","rebounds","assists"].every(k=>Number.isFinite(out[k])))
      put("pra",out.points+out.rebounds+out.assists);
  }else if(sport==="mlb"){
    if(cat.includes("bat")){
      put("hits",at("H"));put("runs",at("R"));put("rbis",at("RBI"));
      put("homeRuns",at("HR"));put("walks",at("BB"));put("atBats",at("AB"));
      put("battingStrikeouts",at("SO","K"));
      const h=at("H"),d=at("2B"),t=at("3B"),hr=at("HR");
      if([h,d,t,hr].every(Number.isFinite)&&h>=d+t+hr)
        put("totalBases",h+d+2*t+3*hr);
    }else if(cat.includes("pitch")){
      put("pitcherKs",at("K","SO"));
      const ip=String(map.IP||"");
      if(/^\d+(?:\.[012])?$/.test(ip)){
        const [whole,part="0"]=ip.split(".");
        put("pitchingOuts",Number(whole)*3+Number(part));
      }
    }
  }else if(sport==="soccer"){
    put("shots",at("SH","SHOTS"));put("shotsOnTarget",at("SOG","SOT"));
    put("goals",at("G","GLS","GOALS"));put("assists",at("A","AST"));
    put("saves",at("SV","SAVES"));put("tackles",at("TKL","TCK","TACK"));
    put("fouls",at("FC","FOULS"));
  }
  return out;
}
// Soccer ESPN summaries expose per-athlete stats on summary.rosters rather
// than summary.boxscore.players. Read only explicitly named recorded values.
function soccerRosterPlayers(summary,teamId){
  const clubs=Array.isArray(summary?.rosters)?summary.rosters:[];
  const rows=clubs.filter(x=>String(x.team?.id)===String(teamId))
    .flatMap(x=>Array.isArray(x.roster)?x.roster:[]);
  const out=[];
  for(const row of rows){
    const athlete=row.athlete||{},stats={};
    if(!idOk(athlete.id)||!nameOf(athlete))continue;
    const raw=new Map((Array.isArray(row.stats)?row.stats:[])
      .filter(x=>x&&typeof x.name==="string")
      .map(x=>[x.name,x.value??x.displayValue]));
    const put=(key,...fieldNames)=>{
      for(const name of fieldNames){
        const n=safeNum(raw.get(name));
        if(n!==null&&n>=0){stats[key]=n;return;}
      }
    };
    put("goals","totalGoals","goals");
    put("assists","goalAssists","assists");
    put("shots","totalShots","shots");
    put("shotsOnTarget","shotsOnTarget");
    put("tackles","totalTackles","tackles");
    put("fouls","foulsCommitted");
    put("saves","saves");
    if(!Object.keys(stats).length)continue;
    out.push({id:String(athlete.id),name:nameOf(athlete),
      position:codeOf(row.position)||codeOf(athlete.position),
      stats,verified:true});
  }
  const unique=new Map(out.map(x=>[x.id,x]));
  return [...unique.values()];
}
export function playersFromBoxscore(summary,sport,teamId){
  if(sport==="soccer")return soccerRosterPlayers(summary,teamId);
  const roster=summary?.boxscore?.players;
  if(!Array.isArray(roster))return [];
  const players=new Map();
  for(const team of roster){
    if(String(team.team?.id)!==String(teamId))continue;
    for(const group of team.statistics||[]){
      for(const row of group.athletes||[]){
        const a=row.athlete||row;
        if(!idOk(a.id)||!nameOf(a)||row.didNotPlay===true||row.stats===null)continue;
        const stats=statsFrom(group,row,sport);
        if(!Object.keys(stats).length)continue;
        const old=players.get(String(a.id))||{id:String(a.id),name:nameOf(a),
          position:codeOf(a.position)||codeOf(row.position)||"",
          stats:{},verified:true};
        if(!old.position)old.position=codeOf(a.position)||codeOf(row.position)||"";
        Object.assign(old.stats,stats);
        players.set(old.id,old);
      }
    }
  }
  // PRA is computed from the full player, not an isolated stat category.
  if(["nba","ncaab"].includes(sport))for(const player of players.values()){
    if(["points","rebounds","assists"].every(k=>Number.isFinite(player.stats[k])))
      player.stats.pra=player.stats.points+player.stats.rebounds+player.stats.assists;
  }
  return [...players.values()];
}
export function gamelogEvents(payload,season,cutoff){
  const raw=payload?.events||payload?.games||payload?.gameLog;
  const entries=Array.isArray(raw)?raw.map(e=>[null,e]):
    raw&&typeof raw==="object"?Object.entries(raw):[];
  const found=new Map();
  for(const [key,obj] of entries){
    const id=String(obj?.id||obj?.eventId||obj?.event?.id||key||"");
    const date=obj?.date||obj?.gameDate||obj?.eventDate||obj?.event?.date;
    const y=obj?.season?.year||obj?.seasonYear;
    if(!idOk(id)||!date||!Number.isFinite(Date.parse(date))||
      Date.parse(date)>=Date.parse(cutoff)||y&&Number(y)!==Number(season))continue;
    found.set(id,{id,date,season:Number(season)});
  }
  return [...found.values()].sort((a,b)=>Date.parse(b.date)-Date.parse(a.date));
}
export function completedTeamGames(schedule,teamId,before,season){
  const out=[];
  for(const e of schedule?.events||[]){
    const cs=e.competitions?.[0]?.competitors||[];
    const own=cs.find(x=>String(x.team?.id)===String(teamId));
    const opp=cs.find(x=>String(x.team?.id)!==String(teamId));
    if(!own||!opp||!idOk(e.id)||!e.date||Date.parse(e.date)>=Date.parse(before)||
       !Number.isFinite(Date.parse(e.date))||
       !(e.status?.type?.completed===true||e.status?.type?.state==="post"))continue;
    if(e.season?.year&&Number(e.season.year)!==Number(season))continue;
    out.push({id:String(e.id),date:e.date,opponentId:String(opp.team?.id),
      opponent:opp.team?.displayName||opp.team?.name||"Opponent",season:Number(season)});
  }
  return out.sort((a,b)=>Date.parse(b.date)-Date.parse(a.date));
}
function playingClub(summary,id){
  if(Array.isArray(summary?.rosters)){
    const clubs=summary.rosters.filter(t=>(t.roster||[]).some(x=>
      String(x.athlete?.id)===String(id)));
    return clubs.length===1?{team:clubs[0].team}:null;
  }
  const teams=summary?.boxscore?.players||[];
  const found=teams.filter(t=>(t.statistics||[]).some(s=>(s.athletes||[]).some(x=>
    String(x.athlete?.id||x.id)===String(id))));
  return found.length===1?found[0]:null;
}
function volumeStat(sport,role,stat){
  if(["nfl","ncaaf"].includes(sport)){
    if(role==="QB")return ["rushingYards","rushAttempts","rushingTDs"].includes(stat)
      ?"rushAttempts":"passAttempts";
    if(["RB","WR","TE"].includes(role))
      return ["receptions","receivingYards","targets","receivingTDs"].includes(stat)
        ?"targets":"rushAttempts";
  }
  if(["nba","ncaab"].includes(sport))return "fieldGoalAttempts";
  if(sport==="mlb")return role==="P"&&stat==="pitcherKs"?"atBats":
    role==="BATTER"?"atBats":null;
  if(sport==="soccer")return role==="GK"?null:"shots";
  return null;
}
export function concededAgainstPosition(summary,{sport,defenseId,role,stat}){
  const teams=sport==="soccer"&&Array.isArray(summary?.rosters)
    ?summary.rosters:summary?.boxscore?.players||[];
  if(teams.length!==2)return null;
  const other=teams.find(t=>String(t.team?.id)!==String(defenseId));
  if(!teams.some(t=>String(t.team?.id)===String(defenseId))||!other?.team?.id)return null;
  const lineup=playersFromBoxscore(summary,sport,other.team.id);
  const volume=volumeStat(sport,role,stat);
  if(!volume)return null;
  const unitRole=sport==="mlb"&&role==="P"?"BATTER":role;
  const observedStat=sport==="mlb"&&role==="P"&&stat==="pitcherKs"
    ?"battingStrikeouts":stat;
  // NBA and college boxscores usually label players simply G or F, even
  // when a team roster identifies PG/SG/SF/PF. Match recorded position
  // *families* without guessing a more specific player role.
  const comparableBasketRole=r=>["PG","SG","G"].includes(r)?"G":
    ["SF","PF","F"].includes(r)?"F":r;
  const relevant=lineup.filter(x=>{
    const observed=positionGroup(sport,x.position);
    return ["nba","ncaab"].includes(sport)
      ?comparableBasketRole(observed)===comparableBasketRole(unitRole)
      :observed===unitRole;
  });
  if(!relevant.length)return null;
  // Unknown positive contributors can understate the full position group.
  // Prefer missing to a falsely low defensive allowance.
  if(lineup.some(x=>!positionGroup(sport,x.position)&&
       (x.stats[observedStat]||0)>0))return null;
  if(!relevant.every(x=>Number.isFinite(x.stats[observedStat])&&
       Number.isFinite(x.stats[volume])))return null;
  return {allowed:relevant.reduce((sum,x)=>sum+x.stats[observedStat],0),
    volume:relevant.reduce((sum,x)=>sum+x.stats[volume],0)};
}
export function makeEvidenceClient({fetcher=globalThis.fetch,concurrency=6,onProgress=()=>{}}={}){
  const cache=new Map(),queue=[];let active=0,completed=0;
  const pump=()=>{
    while(active<concurrency&&queue.length){
      const job=queue.shift();active++;
      Promise.resolve().then(job.work).then(job.resolve,job.reject).finally(()=>{
        completed++;active--;onProgress({completed,active,queued:queue.length});pump();
      });
    }
  };
  function call(params){
    const key=Object.entries(params).sort((a,b)=>a[0].localeCompare(b[0]))
      .map(([k,v])=>k+"="+v).join("&");
    if(!cache.has(key))cache.set(key,new Promise((resolve,reject)=>{
      queue.push({resolve,reject,work:async()=>{
        const response=await fetcher("/api/espn?"+new URLSearchParams(params),{
          headers:{"Accept":"application/json"}});
        if(!response.ok)throw Error("ESPN "+params.kind+" returned "+response.status);
        const json=await response.json();
        if(json?.error)throw Error(json.error);
        return json;
      }});pump();
    }));
    return cache.get(key);
  }
  return {call,stats:()=>({completed,active,queued:queue.length,unique:cache.size})};
}
function flattenRoster(payload){
  const out=[],visit=(entry,depth=0)=>{
    if(!entry||typeof entry!=="object"||depth>5)return;
    const athlete=entry.athlete||entry.player||entry;
    if(idOk(athlete.id)&&nameOf(athlete))
      out.push({id:String(athlete.id),name:nameOf(athlete),
        position:codeOf(athlete.position)||codeOf(entry.position),
        visuals:extractRosterVisuals(athlete)});
    for(const k of ["athletes","players","roster","entries","items","groups"]){
      if(Array.isArray(entry[k]))for(const child of entry[k])visit(child,depth+1);
    }
  };
  visit(payload);
  const uniq=new Map(out.map(x=>[x.id,x]));
  return [...uniq.values()];
}
async function findVerifiedAthlete(client,offer,season,teamId,sport,league){
  const params={sport,kind:"roster",teamId:String(teamId),season:String(season)};
  if(sport==="soccer")params.league=league;
  const roster=flattenRoster(await client.call(params));
  const matches=roster.filter(a=>{
    const sameIdentity=offer.espnPlayerId?
      String(offer.espnPlayerId)===a.id:normalize(a.name)===normalize(offer.player);
    const role=positionGroup(sport,a.position);
    return sameIdentity && role && (!offer.position ||
      role===positionGroup(sport,offer.position));
  });
  return matches.length===1?matches[0]:null;
}
function seasonFromEvent(sport,date,explicit,league="eng.1"){
  if(Number.isInteger(Number(explicit))&&Number(explicit)>1900)return Number(explicit);
  const y=Number(String(date).slice(0,4)),m=Number(String(date).slice(5,7));
  // MLS is calendar-year, unlike Aug-May European soccer competitions.
  if(sport==="soccer")return league==="usa.1"?y:m<7?y-1:y;
  if(["nfl","ncaaf"].includes(sport))return m<7?y-1:y;
  if(["nba","ncaab"].includes(sport))return m>=7?y+1:y;
  return y;
}
export async function loadVerifiedEvidence({client,offer,game,league="eng.1",onStage=()=>{}}){
  const sport=offer.sport,season=seasonFromEvent(sport,game.date,game.season,league);
  // PropLine generally identifies the player without a roster position.
  // Verify the athlete on BOTH participating official ESPN team rosters,
  // requiring exactly one matching identity and usable role.
  const sides=[game.home,game.away].filter(t=>t?.id &&
    (!offer.espnTeamId || String(t.id)===String(offer.espnTeamId)));
  const candidates=await Promise.allSettled(sides.map(async team=>({
    team,player:await findVerifiedAthlete(client,offer,season,team.id,sport,league)
  })));
  const verified=candidates.filter(x=>x.status==="fulfilled"&&x.value.player)
    .map(x=>x.value);
  if(verified.length!==1)
    throw Error("Player identity and position could not be uniquely confirmed on the current fixture's rosters.");
  const {team,player}=verified[0];
  const enemy=([game.home,game.away]).find(t=>t!==team);
  if(!enemy?.id)throw Error("Opposing team ID could not be verified.");
  const base={sport,...(sport==="soccer"?{league}:{})};
  const years=[season,season-1,season-2];
  const records=[],notes=[],summaryCache=new Map(),schedules=new Map();
  const summary=id=>{
    if(!summaryCache.has(id))summaryCache.set(id,client.call({...base,kind:"summary",gameId:id}));
    return summaryCache.get(id);
  };
  const schedule=(id,year)=>{
    const key=id+"|"+year;
    if(!schedules.has(key))schedules.set(key,client.call({...base,
      kind:"schedule",teamId:id,season:String(year)}));
    return schedules.get(key);
  };
  for(const year of years){
    onStage("Loading verified "+year+" athlete games for "+offer.player+"…");
    let events=[];
    try{
      const payload=await client.call({...base,kind:"gamelog",
        playerId:player.id,season:String(year)});
      events=gamelogEvents(payload,year,game.date);
    }catch(error){notes.push(year+": athlete game log unavailable — "+error.message);continue;}
    // Every found season event is eligible; no fabricated padding and no
    // silently mixing other seasons. Both old and current teams are allowed.
    const complete=await Promise.allSettled(events.map(g=>summary(g.id)));
    for(let i=0;i<events.length;i++){
      if(complete[i].status!=="fulfilled")continue;
      const box=complete[i].value,club=playingClub(box,player.id);
      if(!club?.team?.id)continue;
      const values=playersFromBoxscore(box,sport,club.team.id)
        .filter(a=>a.id===player.id);
      if(values.length!==1||!Number.isFinite(values[0].stats[offer.stat]))continue;
      const opponents=sport==="soccer"&&Array.isArray(box.rosters)
        ?box.rosters:box.boxscore?.players||[];
      const rival=opponents.find(t=>
        String(t.team?.id)!==String(club.team.id));
      const date=box.header?.competitions?.[0]?.date||events[i].date;
      const officialSeason=seasonFromEvent(sport,date,
        box.header?.events?.[0]?.season?.year??null,league);
      if(!rival?.team?.id||!date||Date.parse(date)>=Date.parse(game.date)||
        officialSeason!==year)continue;
      records.push({id:events[i].id,date,season:year,playerId:player.id,
        stat:offer.stat,sport,team:club.team?.displayName||club.team?.name||"",
        opponent:rival.team?.displayName||rival.team?.name||"Opponent",
        opponentId:String(rival.team.id),
        actual:values[0].stats[offer.stat],verified:true,source:"ESPN game summary"});
    }
  }
  // NFL: a much simpler real defensive rank comparison. Fetch each historical
  // opponent's ESPN team statistics for its own season, plus this week's
  // upcoming defense. Never rank a selected subset of player opponents.
  if(sport==="nfl"){
    onStage("Comparing ESPN NFL rushing/pass defense league rankings…");
    const asked=new Map();
    const add=(teamId,year)=>{
      const key=String(teamId)+"|"+year;
      if(!asked.has(key))asked.set(key,{teamId:String(teamId),year});
    };
    add(enemy.id,season);
    for(const row of records)add(row.opponentId,row.season);
    const needs=[...asked.values()];
    const responses=await Promise.allSettled(needs.map(({teamId,year})=>
      client.call({sport:"nfl",kind:"teamstats",teamId,season:String(year)})));
    const rankingByTeamSeason=new Map();
    for(let i=0;i<needs.length;i++){
      const item=responses[i],entry=needs[i];
      if(item.status!=="fulfilled")continue;
      const parsed=parseFootballDefenseRanks(item.value,{
        teamId:entry.teamId,season:entry.year
      });
      if(parsed)rankingByTeamSeason.set(entry.teamId+"|"+entry.year,parsed);
    }
    const selected=rankingByTeamSeason.get(String(enemy.id)+"|"+season)||null;
    const profiles=records.map(g=>{
      const defensive=rankingByTeamSeason.get(g.opponentId+"|"+g.season);
      return defensive?{...defensive,gameId:g.id}:null;
    }).filter(Boolean);
    if(!selected)notes.push("Upcoming opponent's verified ESPN rushing/passing defensive ranks unavailable.");
    if(profiles.length<records.length)notes.push(
      "Some historical opponent defense ranks are unavailable; unmatched games are excluded.");
    notes.push("NFL rank comparison uses ESPN season-aggregate rushing and passing defense ranks, within ±3 places; past season final rankings may include games after the matchup.");
    return {player,team,enemy,season,games:records,upcomingDefense:selected,
      defensiveProfiles:profiles,matchupModel:"nfl-ranks",notes,
      source:"ESPN athlete game summaries + opponent league rankings"};
  }
  const role=positionGroup(sport,offer.position);
  const desired=[{teamId:String(enemy.id),season,cutoff:game.date,
    gameId:null,kind:"target"}];
  for(const row of records)desired.push({teamId:row.opponentId,
    season:row.season,cutoff:row.date,gameId:row.id,kind:"historical"});
  const unique=new Map(desired.map(x=>[
    [x.teamId,x.season,x.cutoff].join("|"),x]));
  const profiles=[];
  onStage("Verifying pregame "+role+" defensive matchups…");
  for(const demand of unique.values()){
    let prior;
    try{
      prior=completedTeamGames(await schedule(demand.teamId,demand.season),
        demand.teamId,demand.cutoff,demand.season).slice(0,8);
    }catch{continue;}
    const previous=await Promise.allSettled(prior.map(g=>summary(g.id)));
    const measurements=[];
    for(const item of previous){
      if(item.status!=="fulfilled")continue;
      const value=concededAgainstPosition(item.value,{sport,defenseId:demand.teamId,
        role,stat:offer.stat});
      if(value)measurements.push(value);
    }
    if(measurements.length<3)continue;
    profiles.push({sport,season:demand.season,position:role,stat:offer.stat,
      teamId:demand.teamId,gameId:demand.gameId,league:sport==="soccer"?league:null,
      asOf:demand.cutoff,pregameGames:measurements.length,verified:true,
      metrics:{allowed:measurements.reduce((a,b)=>a+b.allowed,0)/measurements.length,
        volume:measurements.reduce((a,b)=>a+b.volume,0)/measurements.length}});
  }
  return {player,team,enemy,season,games:records,upcomingDefense:
    profiles.find(p=>p.teamId===String(enemy.id)&&p.gameId===null)||null,
    defensiveProfiles:profiles,notes,source:"ESPN public game summaries (provisional)"};
}
