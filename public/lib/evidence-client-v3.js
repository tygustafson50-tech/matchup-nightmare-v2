/**
 * Matchup Nightmare V3 ESPN evidence transport.
 * Reads source boxscores and pregame defender histories. It NEVER creates
 * lines, fills missing stats with zero, or calls the deleted prediction engine.
 * ESPN public endpoints are provisional: missing source => incomplete evidence.
 */
import {positionGroup,supportsMarket} from "./research-v3.js";
import {parseFootballDefenseRanks} from "./football-defense-ranks.js";
import {extractRosterVisuals} from "./player-profile-v3.js";
import {deepStatSpec,makeDeepProfile} from "./sport-defense-depth.js";
import {strictDefenseGate,buildDefenseContext,NFL_MAX_CANDIDATES}
  from "./nfl-defense-depth.js";
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
export function playersFromBoxscore(summary,sport,teamId,positionsById=null){
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
        const verifiedPosition=positionsById instanceof Map
          ?positionsById.get(String(a.id))||"": "";
        const observedPosition=codeOf(a.position)||codeOf(row.position)||
          verifiedPosition;
        const old=players.get(String(a.id))||{id:String(a.id),name:nameOf(a),
          position:observedPosition,stats:{},verified:true};
        if(!old.position)old.position=observedPosition;
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
    const date=obj?.gameDate||obj?.date||obj?.eventDate||obj?.event?.date;
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
    const competition=e.competitions?.[0];
    const cs=competition?.competitors||[];
    const own=cs.find(x=>String(x.team?.id)===String(teamId));
    const opp=cs.find(x=>String(x.team?.id)!==String(teamId));
    // CRITICAL: ESPN /teams/{id}/schedule puts game status inside
    // event.competitions[0].status, while the scoreboard often uses
    // event.status. The previous e.status-only check excluded EVERY
    // completed team-schedule event and forced similar-defense counts to 0.
    const state=competition?.status?.type||e.status?.type;
    const complete=state?.completed===true||state?.state==="post";
    if(!own||!opp||!idOk(e.id)||!e.date||Date.parse(e.date)>=Date.parse(before)||
       !Number.isFinite(Date.parse(e.date))||!complete)continue;
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
  if(sport==="mlb")return role==="P"||role==="BATTER"?"atBats":null;
  if(sport==="soccer")return "shots";
  return null;
}
export function concededAgainstPosition(summary,{sport,defenseId,role,stat}){
  const teams=sport==="soccer"&&Array.isArray(summary?.rosters)
    ?summary.rosters:summary?.boxscore?.players||[];
  if(teams.length!==2)return null;
  const own=teams.find(t=>String(t.team?.id)===String(defenseId));
  const other=teams.find(t=>String(t.team?.id)!==String(defenseId));
  if(!own?.team?.id||!other?.team?.id)return null;
  // Pitcher props depend on the UPCOMING OPPONENT'S batting behavior,
  // not how many strikeouts its pitching staff conceded to other batters.
  // Goalkeeper saves depend on UPCOMING OPPONENT'S shot output.
  const offenseProxy=sport==="mlb"&&role==="P"||
    sport==="soccer"&&role==="GK";
  const sourceTeamId=offenseProxy?own.team.id:other.team.id;
  const lineup=playersFromBoxscore(summary,sport,sourceTeamId);
  const volume=volumeStat(sport,role,stat);
  if(!volume)return null;
  const unitRole=sport==="mlb"&&role==="P"?"BATTER":role;
  const observedStat=sport==="mlb"&&role==="P"
    ?stat==="pitcherKs"?"battingStrikeouts":
      stat==="pitchingOuts"?"atBats":stat
    :sport==="soccer"&&role==="GK"&&stat==="saves"
      ?"shotsOnTarget":stat;
  // NBA and college boxscores usually label players simply G or F, even
  // when a team roster identifies PG/SG/SF/PF. Match recorded position
  // *families* without guessing a more specific player role.
  const comparableBasketRole=r=>["PG","SG","G"].includes(r)?"G":
    ["SF","PF","F"].includes(r)?"F":r;
  const relevant=lineup.filter(x=>{
    const observed=positionGroup(sport,x.position);
    return sport==="soccer"&&role==="GK"
      ?["F","M","D"].includes(observed)
      :["nba","ncaab"].includes(sport)
        ?comparableBasketRole(observed)===comparableBasketRole(unitRole)
        :observed===unitRole;
  });
  if(!relevant.length)return null;
  // Unknown positive contributors can understate the full position group.
  // Prefer missing to a falsely low defensive allowance.
  if(lineup.some(x=>!positionGroup(sport,x.position)&&
       (x.stats[observedStat]||0)>0))return null;
  // ESPN football sometimes omits targets, but records receptions. Only
  // use another actual source field as the explicitly identified proxy.
  const chosenVolume=volume==="targets" &&
    !relevant.every(x=>Number.isFinite(x.stats.targets)) &&
    relevant.every(x=>Number.isFinite(x.stats.receptions))
      ?"receptions":volume;
  if(!relevant.every(x=>Number.isFinite(x.stats[observedStat])&&
       Number.isFinite(x.stats[chosenVolume])))return null;
  return {allowed:relevant.reduce((sum,x)=>sum+x.stats[observedStat],0),
    volume:relevant.reduce((sum,x)=>sum+x.stats[chosenVolume],0),
    volumeSource:chosenVolume,statSource:observedStat};
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
// Provider names can use initials or omit generational suffixes. Only
// use an unambiguous exact/initial alias on an OFFICIAL fixture roster;
// a sportsbook nickname alone never verifies player identity.
function athleteNameMatch(quoted,official){
  const components=value=>String(value||"").normalize("NFKD")
    .replace(/[\u0300-\u036f]/g,"").toLowerCase()
    .replace(/\s+\([a-z]{2,4}\)\s*$/i,"")
    .replace(/[^a-z0-9-\s]/g," ").replace(/\b(jr|sr|ii|iii|iv)\b/g,"")
    .trim().split(/\s+/).filter(Boolean);
  const a=components(quoted),b=components(official);
  if(!a.length||!b.length)return false;
  if(a.join(" ")===b.join(" "))return true;
  // 'J. Smith-Njigba' -> 'Jaxon Smith-Njigba' but never guess
  // different full first names or distinct surnames.
  return a.length>=2&&b.length>=2&&a[0].length===1&&
    a[0]===b[0][0]&&a.slice(1).join(" ")===b.slice(1).join(" ");
}
async function findVerifiedAthlete(client,offer,season,teamId,sport,league){
  const params={sport,kind:"roster",teamId:String(teamId),season:String(season)};
  if(sport==="soccer")params.league=league;
  const roster=flattenRoster(await client.call(params));
  const matches=roster.filter(a=>{
    const sameIdentity=offer.espnPlayerId?
      String(offer.espnPlayerId)===a.id:athleteNameMatch(offer.player,a.name);
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
  // Current season feeds recent-five only; previous three feed comparisons.
  const years=[season,season-1,season-2,season-3];
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
    }catch(error){
      // ESPN's site.web.api athlete gamelog currently answers HTTP 403 in
      // production, even though official team schedules and boxscores work.
      // Do not discard a player's entire history because one feed is blocked.
      notes.push(year+": athlete game log unavailable — "+error.message);
    }
    if(!events.length){
      try{
        // A completed team schedule is independently recorded by ESPN; the
        // summary still has to contain THIS athlete's real stat to qualify.
        // Use recent completed games to control calls for longer seasons.
        const caps={nfl:22,ncaaf:18,nba:25,ncaab:25,mlb:30,soccer:25};
        events=completedTeamGames(await schedule(team.id,year),
          team.id,game.date,year).slice(0,caps[sport]||20);
        if(events.length)notes.push(year+": athlete history recovered from official completed team fixtures.");
      }catch(error){
        notes.push(year+": completed ESPN team schedule unavailable — "+error.message);
      }
    }
    if(!events.length)continue;
    // All recovered game IDs must still be matched to the official athlete
    // in each completed ESPN boxscore. A team appearance is not a player stat.
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
    // Keep current-season opponent rankings for badges on recent games.
    // Historical SIMILAR selection still filters to earlier seasons below.
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
    const role=positionGroup(sport,player.position);
    // Fetch additional position-specific pregame coverage ONLY for defenses
    // that pass both published league-rank gates. This cuts ESPN requests
    // versus fetching arbitrary deep coverage for every team in NFL history.
    const ranked=records.filter(g=>g.season!==season).map(g=>{
      const profile=rankingByTeamSeason.get(g.opponentId+"|"+g.season);
      const rank=selected&&profile?strictDefenseGate(selected,profile,offer.stat):
        {ok:false};
      return {game:g,profile,rank};
    }).filter(x=>x.rank.ok).sort((a,b)=>
      Number(b.rank.rankMatch)-Number(a.rank.rankMatch)||
      a.rank.primaryGap-b.rank.primaryGap||
      a.rank.primaryYards-b.rank.primaryYards||
      Date.parse(b.game.date)-Date.parse(a.game.date));
    // Try multiple seasons if ESPN lacks an early-game context, but do not
    // spend the entire quota on repeated matches against the same defense.
    const candidate=[],perDefense=new Map();
    // Only earlier completed seasons can contribute similar matchups;
    // rank matches have already excluded all current-season player games.
    const priority=ranked;
    for(const row of priority){
      const id=row.game.opponentId;
      const count=perDefense.get(id)||0;
      if(count>=2)continue;
      perDefense.set(id,count+1);
      candidate.push(row);
      if(candidate.length>=NFL_MAX_CANDIDATES)break;
    }
    onStage("Checking "+candidate.length+" NFL rank-similar defenses for "+
      role+" coverage and RB checkdown proxies…");
    // ESPN NFL game-summary athlete rows often omit position entirely,
    // even for rushers/receivers whose actual stats are present. Resolve
    // the athlete ID from the official opponent roster for THAT season,
    // never guess RB/WR/TE from the receiving/rushing boxscore group.
    const resolvePositions=async (box,defenseId,year)=>{
      const opponentTeam=(box?.boxscore?.players||[]).find(t=>
        t?.team?.id&&String(t.team.id)!==String(defenseId));
      if(!opponentTeam?.team?.id)return new Map();
      const roster=await client.call({sport:"nfl",kind:"roster",
        teamId:String(opponentTeam.team.id),season:String(year)});
      return new Map(flattenRoster(roster).filter(p=>p.position)
        .map(p=>[p.id,p.position]));
    };
    const fetchContext=(teamId,year,cutoff)=>
      buildDefenseContext({teamId,season:year,cutoff,role,stat:offer.stat,
        schedule,summary,resolvePositions});
    const verifiedContext=await Promise.allSettled([
      fetchContext(enemy.id,season,game.date),
      ...candidate.map(x=>fetchContext(x.game.opponentId,
        x.game.season,x.game.date))
    ]);
    const currentContext=verifiedContext[0].status==="fulfilled"?
      verifiedContext[0].value:null;
    const detailed=new Map();
    for(let i=0;i<candidate.length;i++){
      const value=verifiedContext[i+1];
      if(value.status==="fulfilled")
        detailed.set(candidate[i].game.id,value.value);
    }
    const contextualProfiles=profiles.map(p=>({
      ...p,context:detailed.get(p.gameId)||null
    }));
    if(!currentContext||currentContext.verifiedGames<3)
      notes.push("Fewer than three verified prior games against the upcoming defense's relevant "+
        role+" stat; strict matchups are unavailable.");
    if(detailed.size<candidate.length)
      notes.push("Some candidate opponent position-specific box scores could not be verified.");
    notes.push("Strict NFL defense matching requires both passing and rushing ranks, yards allowed, and 3+ PRIOR ESPN games allowed to the player's position. RB catches allowed is a checkdown proxy, not identified routes.");
    notes.push("Season-to-date/current versus full-season/historical league rankings may contain games after the historical matchup. Only 4–6 strongly matched games can support an OVER; fewer are marked insufficient.");
    return {player,team,enemy,season,games:records,upcomingDefense:selected,
      upcomingContext:currentContext,defensiveProfiles:contextualProfiles,
      matchupModel:"nfl-depth",notes,
      source:"ESPN athlete summaries, team defense ranks and prior-game position totals"};
  }
  // PropLine rarely includes a position. The roster has ALREADY
  // identified the real athlete's ESPN position above.
  const role=positionGroup(sport,player.position);
  const desired=[{teamId:String(enemy.id),season,cutoff:game.date,
    gameId:null,kind:"target"}];
  // Recent games still receive their defensive badges; the analyzer
  // forbids those current-season games from entering historical matches.
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
    const spec=deepStatSpec(sport,offer.stat,role);
    const measurements=[],secondary={};
    for(const key of spec?.secondary||[])secondary[key]=[];
    for(const item of previous){
      if(item.status!=="fulfilled")continue;
      const value=concededAgainstPosition(item.value,{sport,
        defenseId:demand.teamId,role,stat:offer.stat});
      if(value)measurements.push(value);
      for(const key of spec?.secondary||[]){
        const feature=concededAgainstPosition(item.value,{sport,
          defenseId:demand.teamId,role,stat:key});
        if(feature)secondary[key].push(feature.allowed);
      }
    }
    if(measurements.length<3)continue;
    const mean=items=>items.reduce((sum,x)=>sum+x,0)/items.length;
    const metrics={allowed:mean(measurements.map(x=>x.allowed)),
      volume:mean(measurements.map(x=>x.volume))};
    const extra=Object.fromEntries(Object.entries(secondary)
      .filter(([,items])=>items.length>=3).map(([key,items])=>[key,mean(items)]));
    const source=Object.fromEntries(Object.entries(secondary)
      .map(([key,items])=>[key,items.length]));
    const profile=makeDeepProfile({sport,role,stat:offer.stat,
      teamId:demand.teamId,gameId:demand.gameId,
      season:demand.season,asOf:demand.cutoff,metrics,
      verifiedGames:measurements.length,secondaryStats:extra,
      secondaryGames:source,league:sport==="soccer"?league:null});
    if(profile)profiles.push(profile);
  }
  return {player,team,enemy,season,games:records,upcomingDefense:
    profiles.find(p=>p.teamId===String(enemy.id)&&p.gameId===null)||null,
    defensiveProfiles:profiles,matchupModel:"multi-sport-depth",
    notes,source:"ESPN real player results + stat-specific prior opponent position profiles"};
}
