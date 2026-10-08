/**
 * GET /api/scan?sport=nfl&date=YYYY-MM-DD&gameId=...&mode=both|similar|recent
 * Historical positional / matchup-unit rates are computed from completed
 * player boxscores, never inferred from whole-team scoring totals.
 * ESPN data is provisional and has no coverage guarantee.
 */
import {
  CONFIG,SOCCER_LEAGUES,priorGames,extractBoxscore,buildPositionProfile,
  rosterPositionIndex,attachRosterPositions,matchupRole,scanTrends
} from "../../lib/auto-scan.js";

const ESPN="https://site.api.espn.com/apis/site/v2/sports/";
const MAX_PRIOR_GAMES=5;
const COMPARABLE_CANDIDATES=3;
const POSITION_PROFILE_GAMES=2;
const TARGET_PROFILE_GAMES=2;
const CONCURRENCY=5;
// CF Free Worker external subrequests limit is 50; reserve headroom for redirects.
const MAX_UPSTREAM_REQUESTS=46;
function inSportSeason(game,season,sport){
  const explicit=game?.season;
  if(explicit!==null&&explicit!==undefined&&Number.isInteger(Number(explicit)))
    return Number(explicit)===Number(season);
  const date=String(game?.date||"");
  const year=Number(date.slice(0,4)),month=Number(date.slice(5,7));
  if(!Number.isInteger(year)||!Number.isInteger(month)||month<1||month>12)return false;
  // ESPN labels football and many soccer seasons by START year, but
  // NBA/NCAA basketball seasons by END year when explicit metadata is absent.
  if(sport==="nba"||sport==="ncaab")
    return (month>=7?year+1:year)===Number(season);
  if(sport==="nfl"||sport==="ncaaf"||sport==="soccer")
    return (month<7?year-1:year)===Number(season);
  return year===Number(season);
}
function historicGames(schedule,teamId,before,season,sport,limit){
  return priorGames(schedule,teamId,before,180)
    .filter(g=>inSportSeason(g,season,sport)).slice(0,limit);
}
function fallbackSeasonYear(sport,gameDate){
  const year=Number(String(gameDate).slice(0,4));
  const month=Number(String(gameDate).slice(5,7));
  if(!Number.isInteger(year)||!Number.isInteger(month))return null;
  // Jan/Feb football and European soccer belong to the previous
  // start-year season; NBA/NCAA basketball commonly use end-year labels.
  // Always trust explicit event.season.year when present.
  if((sport==="nfl"||sport==="ncaaf"||sport==="soccer")&&month<7)return year-1;
  if((sport==="nba"||sport==="ncaab")&&month>=7)return year+1;
  return year;
}

const respond=(data,status=200)=>new Response(JSON.stringify(data),{
  status,headers:{
    "content-type":"application/json; charset=utf-8",
    "cache-control":status===200?"public, max-age=120":"no-store",
    "x-content-type-options":"nosniff"
  }
});
function validDate(date){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date))return false;
  const d=new Date(date+"T00:00:00Z");
  return !Number.isNaN(d.getTime())&&d.toISOString().slice(0,10)===date;
}
function createFetcher(diagnostics){
  const memo=new Map();
  const request=async(url)=>{
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),9000);
    try{
      const response=await fetch(url,{signal:controller.signal,headers:{Accept:"application/json"}});
      if(!response.ok)throw Error("HTTP "+response.status);
      return await response.json();
    }finally{clearTimeout(timer);}
  };
  return (url)=>{
    if(memo.has(url))return memo.get(url);
    if(diagnostics.upstreamRequests>=MAX_UPSTREAM_REQUESTS)
      return Promise.reject(Error("Free-plan request budget reached; this profile is unavailable"));
    diagnostics.upstreamRequests++;
    const promise=request(url);
    memo.set(url,promise);
    return promise;
  };
}
async function pool(items,fn){
  const out=new Array(items.length);
  let next=0;
  await Promise.all(Array.from({length:Math.min(CONCURRENCY,items.length)},async()=>{
    while(next<items.length){
      const i=next++;
      try{out[i]={ok:true,value:await fn(items[i])};}
      catch(err){out[i]={ok:false,error:String(err.message).slice(0,130)};}
    }
  }));
  return out;
}
export async function onRequestGet({request}){
  const query=new URL(request.url).searchParams;
  const sport=query.get("sport")||"nfl",date=query.get("date")||"";
  const gameId=query.get("gameId")||"",requestedMode=query.get("mode");
  const focusTeam=query.get("focusTeam");
  const mode=requestedMode==="recent"?"recent":requestedMode==="similar"?"similar":"both";
  if(focusTeam!==null&&focusTeam!=="home"&&focusTeam!=="away")
    return respond({error:"focusTeam must be home or away."},400);
  if(!Object.hasOwn(CONFIG,sport)||!validDate(date)||!/^\d{5,15}$/.test(gameId))
    return respond({error:"Select a valid sport, date and scheduled game."},400);
  const league=sport==="soccer"?(query.get("league")||"eng.1"):CONFIG[sport].path.split("/")[1];
  if(sport==="soccer"&&!SOCCER_LEAGUES.has(league))return respond({error:"Unsupported soccer league"},400);
  const path=sport==="soccer"?"soccer/"+league:CONFIG[sport].path;
  const base=ESPN+path;
  const notes=[],diagnostics={
    upstreamRequests:0,offenseSchedules:0,offenseBoxscores:0,
    missingOffenseBoxscores:0,defenseSchedules:0,defenseBoxscores:0,
    missingDefenseBoxscores:0,defenseProfiles:0,
    rosterLookups:0,rosterLookupsSucceeded:0,rosterLookupsFailed:0,
    positionRowsResolved:0,positionRowsMissing:0,defenseProfileStatTypes:0,
    scanFocus:focusTeam||"both",selectedTeams:focusTeam?1:2
  };
  const getJSON=createFetcher(diagnostics);
  try{
    const board=await getJSON(base+"/scoreboard?dates="+date.replaceAll("-","")+"&limit=100");
    const event=(board.events||[]).find(e=>String(e.id)===gameId);
    if(!event)return respond({error:"Selected game was not found on the schedule for this date."},404);
    const competitors=event.competitions?.[0]?.competitors||[];
    if(competitors.length!==2)return respond({error:"Couldn't validate team identifiers for this game."},422);
    const teams=competitors.map(c=>({
      id:String(c.team?.id||""),name:c.team?.displayName||c.team?.name||"Team",
      logo:c.team?.logo||"",homeAway:c.homeAway
    }));
    if(teams.some(t=>!/^\d+$/.test(t.id)))return respond({error:"Missing stable team IDs."},422);
    // One team per request keeps historical ESPN boxscore scanning small.
    const activeTeams=focusTeam?teams.filter(t=>t.homeAway===focusTeam):teams;
    if(!activeTeams.length)return respond({error:"Selected team side was not found."},422);
    const comparableCount=focusTeam?2:COMPARABLE_CANDIDATES;
    const selectedDate=event.date;
    if(!Number.isFinite(Date.parse(selectedDate)))return respond({error:"Game kickoff date unavailable."},422);
    const firstYear=Number(event.season?.year??fallbackSeasonYear(sport,selectedDate));
    if(!Number.isInteger(firstYear)||firstYear<1900||firstYear>2100)
      return respond({error:"Couldn't determine the selected game's sports season."},422);
    // "current" resolves the league's actual selected season (important
    // for Jan/Feb football and spring soccer/basketball cross-year games).
    const requestedSeason=query.get("historySeason");
    const historySeason=requestedSeason===null||requestedSeason==="current"
      ?firstYear:Number(requestedSeason);
    if(!Number.isInteger(historySeason)||historySeason<firstYear-2||
       historySeason>firstYear||!/^\d{4}$/.test(String(historySeason))){
      return respond({error:"Historical season must be the selected season or one of the two seasons before it."},400);
    }
    const seasonYear=String(historySeason);
    const isCurrentSeason=historySeason===firstYear;
    const byTeamSchedule=new Map();
    const scheduleResults=await pool(teams,t=>getJSON(base+"/teams/"+t.id+"/schedule?season="+seasonYear+"&limit=100"));
    for(let i=0;i<teams.length;i++){
      if(scheduleResults[i].ok){byTeamSchedule.set(teams[i].id,scheduleResults[i].value);diagnostics.offenseSchedules++;}
      else notes.push("Historical schedule unavailable: "+teams[i].name);
    }
    if(!byTeamSchedule.size)return respond({error:"No accessible completed schedules for this game.",notes,diagnostics},503);

    const histories=new Map();
    for(const t of teams)t.targetOpponentId=teams.find(x=>x.id!==t.id).id;
    for(const t of activeTeams){
      histories.set(t.id,byTeamSchedule.has(t.id)
        ?historicGames(byTeamSchedule.get(t.id),t.id,selectedDate,historySeason,sport,MAX_PRIOR_GAMES):[]);
    }
    const offenseGames=[...new Map([...histories.values()].flat().map(g=>[g.id,g])).values()];
    const offenseResponses=await pool(offenseGames,g=>getJSON(base+"/summary?event="+g.id));
    const summaryById=new Map();
    for(let i=0;i<offenseGames.length;i++){
      if(offenseResponses[i].ok){
        summaryById.set(offenseGames[i].id,offenseResponses[i].value);
        diagnostics.offenseBoxscores++;
      }else diagnostics.missingOffenseBoxscores++;
    }

    // Five recent historical opponent defenses per selected team. These
    // profiles are computed as-of the game being compared, not after it.
    const candidateOpponents=new Set();
    for(const t of activeTeams){
      for(const g of (histories.get(t.id)||[]).slice(0,comparableCount)){
        if(!byTeamSchedule.has(g.opponentId))candidateOpponents.add(g.opponentId);
      }
    }
    const needed=[...candidateOpponents];
    const opponentSchedules=await pool(needed,id=>getJSON(base+"/teams/"+id+"/schedule?season="+seasonYear+"&limit=100"));
    for(let i=0;i<needed.length;i++){
      if(opponentSchedules[i].ok){
        byTeamSchedule.set(needed[i],opponentSchedules[i].value);
        diagnostics.defenseSchedules++;
      }else notes.push("Opponent historical position data unavailable for team "+needed[i]);
    }

    const demands=[];
    for(const t of activeTeams){
      const upcomingDefense=t.targetOpponentId;
      const schedule=byTeamSchedule.get(upcomingDefense);
      if(schedule&&isCurrentSeason){
        demands.push({
          defenseId:upcomingDefense,kind:"target",eventId:null,
          games:historicGames(schedule,upcomingDefense,selectedDate,historySeason,sport,TARGET_PROFILE_GAMES)
        });
      }
      for(const past of (histories.get(t.id)||[]).slice(0,comparableCount)){
        const pastSchedule=byTeamSchedule.get(past.opponentId);
        if(pastSchedule){
          demands.push({
            defenseId:past.opponentId,kind:"historical",eventId:past.id,
            games:historicGames(pastSchedule,past.opponentId,past.date,historySeason,sport,POSITION_PROFILE_GAMES)
          });
        }
      }
    }
    // All prior boxscore requests are deduplicated across offense histories
    // and defensive profiles, keeping free-plan limits predictable.
    const defensiveGameIds=[...new Set(demands.flatMap(d=>d.games.map(g=>g.id)))]
      .filter(id=>!summaryById.has(id));
    const defenseResponses=await pool(defensiveGameIds,id=>getJSON(base+"/summary?event="+id));
    for(let i=0;i<defensiveGameIds.length;i++){
      if(defenseResponses[i].ok){
        summaryById.set(defensiveGameIds[i],defenseResponses[i].value);
        diagnostics.defenseBoxscores++;
      }else diagnostics.missingDefenseBoxscores++;
    }

    // ESPN often omits athlete.position from the game stat rows. Verify it
    // using that season's team rosters, prioritizing CURRENT selected players
    // and the upcoming defense's actual historical opponents.
    // Preserve request budget for these position checks rather than spending
    // it entirely on less useful distant historical boxscores.
    const rosterIndex={};
    const rosterWanted=new Map();
    function needRoster(summary,teamId){
      if(sport==="mlb")return false;
      const players=extractBoxscore(summary,sport,teamId);
      return players.some(p=>(CONFIG[sport]?.markets||[]).some(([stat])=>
        Number.isFinite(p.stats?.[stat])&&!matchupRole(sport,p.position,stat)));
    }
    function addRoster(teamId,priority){
      const id=String(teamId||"");
      if(!/^\d+$/.test(id))return;
      const prior=rosterWanted.get(id);
      if(prior===undefined||priority<prior)rosterWanted.set(id,priority);
    }
    for(const t of activeTeams){
      if((histories.get(t.id)||[]).some(g=>summaryById.has(g.id)&&
          needRoster(summaryById.get(g.id),t.id)))addRoster(t.id,0);
    }
    for(const demand of demands){
      for(const g of demand.games){
        const summary=summaryById.get(g.id);
        if(!summary)continue;
        for(const team of summary.boxscore?.players||[]){
          const offenseId=String(team.team?.id||"");
          if(offenseId===String(demand.defenseId))continue;
          if(needRoster(summary,offenseId))addRoster(offenseId,demand.kind==="target"?1:2);
        }
      }
    }
    const rosterIds=[...rosterWanted.entries()]
      .sort((a,b)=>a[1]-b[1]).map(([id])=>id);
    // Keep two spare external requests for provider redirects.
    const capacity=Math.max(0,Math.min(focusTeam?5:14,
      MAX_UPSTREAM_REQUESTS-diagnostics.upstreamRequests-2));
    const rosterResults=await pool(rosterIds.slice(0,capacity),id=>
      getJSON(base+"/teams/"+id+"/roster?season="+seasonYear));
    diagnostics.rosterLookups=rosterResults.length;
    for(let i=0;i<rosterResults.length;i++){
      if(rosterResults[i].ok){
        const id=rosterIds[i];
        const teamRoles=rosterPositionIndex(rosterResults[i].value,id);
        if(Object.keys(teamRoles[id]||{}).length){
          rosterIndex[id]=teamRoles[id];
          diagnostics.rosterLookupsSucceeded++;
        }else diagnostics.rosterLookupsFailed++;
      }else diagnostics.rosterLookupsFailed++;
    }
    // Attach verified position hints to every completed game summary,
    // without changing any player statistics.
    for(const [id,summary] of summaryById){
      summaryById.set(id,attachRosterPositions(summary,rosterIndex));
    }

    const profiles={};
    for(const demand of demands){
      const complete=demand.games.filter(g=>summaryById.has(g.id))
        .map(g=>({id:g.id,summary:summaryById.get(g.id)}));
      const profile=buildPositionProfile(complete,sport,demand.defenseId,2);
      profiles[demand.defenseId]??={};
      if(demand.kind==="target")profiles[demand.defenseId].target=profile;
      else profiles[demand.defenseId][demand.eventId]=profile;
      if(Object.keys(profile).length){
        diagnostics.defenseProfiles++;
        diagnostics.defenseProfileStatTypes+=Object.keys(profile).length;
      }
    }

    const trends=[];
    const normalizedRecords={};
    for(const t of activeTeams){
      const records=(histories.get(t.id)||[]).filter(g=>summaryById.has(g.id))
        .map(g=>({...g,season:historySeason,
          players:extractBoxscore(summaryById.get(g.id),sport,t.id)}));
      for(const record of records){
        for(const player of record.players){
          if(player.position)diagnostics.positionRowsResolved++;
          else diagnostics.positionRowsMissing++;
        }
      }
      normalizedRecords[t.id]=records.map(({id,date,season,opponent,opponentId,players})=>
        ({id,date,season,opponent,opponentId,players}));
      // A historical-season response is one batch of a three-season scan;
      // it cannot legitimately calculate a full multi-season trend alone.
      if(!isCurrentSeason)continue;
      const nextGame={id:gameId,date:selectedDate,sport};
      if(mode==="both"){
        trends.push(...scanTrends(records,t,nextGame,profiles,"similar",3));
        trends.push(...scanTrends(records,t,nextGame,profiles,"recent",3));
      }else trends.push(...scanTrends(records,t,nextGame,profiles,mode,3));
    }

    if(!trends.length&&isCurrentSeason&&requestedSeason===null)
      notes.push("No qualifying 100% historical OVER thresholds with sufficient completed, usable games.");
    if(diagnostics.missingOffenseBoxscores||diagnostics.missingDefenseBoxscores)
      notes.push("Some boxscores were unavailable. Missing data were not replaced with zeros.");
    if(diagnostics.positionRowsMissing)
      notes.push(diagnostics.positionRowsMissing+" sampled player appearances lack verified position metadata. They are not used for similar-defense matching.");
    if(rosterWanted.size>diagnostics.rosterLookups)
      notes.push("Some historical roster positions could not be checked within the free hosting request allowance.");
    if(!diagnostics.defenseProfiles && sport!=="mlb")
      notes.push("No verified position-specific defensive profiles were available from the requested history.");
    if(diagnostics.upstreamRequests>=MAX_UPSTREAM_REQUESTS)
      notes.push("Free Cloudflare request budget reached; positional comparisons may be incomplete.");
    if(sport==="mlb")
      notes.push("Baseball uses pitching-staff concessions and opposing-lineup strikeout tendencies, not a position-guarding model.");
    else
      notes.push("Defense comparisons are based on the relevant player position group and prop statistic, NOT total team scoring allowed.");
    notes.push("Positional defensive samples use at least 2 prior completed games and a 25% similarity tolerance.");
    notes.push("All thresholds are computed for research; no actual PrizePicks lines, odds, or guaranteed probabilities are connected.");

    return respond({
      game:{id:gameId,date:selectedDate,home:teams.find(t=>t.homeAway==="home"),
        away:teams.find(t=>t.homeAway==="away")},
      sport,league,mode,focusTeam:focusTeam||"both",
      count:trends.length,results:trends.slice(0,70),
      season:historySeason,selectedSeason:firstYear,isCurrentSeason,
      // Raw provenance-backed records let the browser recompute ONE trend
      // across the complete three-season window, rather than combining
      // separately manufactured per-season "100%" picks.
      ...(requestedSeason!==null?{seasonBatch:{
        season:historySeason,teams,records:normalizedRecords,defenseProfiles:profiles
      }}:{}),
      notes,diagnostics,
      provider:"ESPN public game summaries (unofficial, incomplete for some leagues)",
      refreshedAt:new Date().toISOString(),
      prizesPicksConnected:false,realOddsConnected:false,
      defensiveModel:"position-and-stat-specific opponent boxscore concessions"
    });
  }catch(error){
    return respond({
      error:"Could not scan this game with available historical data.",
      details:String(error.message).slice(0,130),notes,diagnostics
    },502);
  }
}
