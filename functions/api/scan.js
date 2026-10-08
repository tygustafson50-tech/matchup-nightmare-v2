/**
 * GET /api/scan?sport=nfl&date=YYYY-MM-DD&gameId=...&mode=both|similar|recent
 * Historical positional / matchup-unit rates are computed from completed
 * player boxscores, never inferred from whole-team scoring totals.
 * ESPN data is provisional and has no coverage guarantee.
 */
import {
  CONFIG,SOCCER_LEAGUES,priorGames,extractBoxscore,buildPositionProfile,scanTrends
} from "../../lib/auto-scan.js";

const ESPN="https://site.api.espn.com/apis/site/v2/sports/";
const MAX_PRIOR_GAMES=6;
const COMPARABLE_CANDIDATES=5;
const POSITION_PROFILE_GAMES=2;
const TARGET_PROFILE_GAMES=3;
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
  // NFL/college-football, basketball and soccer seasons can cross calendar years.
  const startsInSummer=sport!=="mlb";
  return (startsInSummer && month<7 ? year-1 : year)===Number(season);
}
function historicGames(schedule,teamId,before,season,sport,limit){
  return priorGames(schedule,teamId,before,180)
    .filter(g=>inSportSeason(g,season,sport)).slice(0,limit);
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
  const mode=requestedMode==="recent"?"recent":requestedMode==="similar"?"similar":"both";
  if(!Object.hasOwn(CONFIG,sport)||!validDate(date)||!/^\d{5,15}$/.test(gameId))
    return respond({error:"Select a valid sport, date and scheduled game."},400);
  const league=sport==="soccer"?(query.get("league")||"eng.1"):CONFIG[sport].path.split("/")[1];
  if(sport==="soccer"&&!SOCCER_LEAGUES.has(league))return respond({error:"Unsupported soccer league"},400);
  const path=sport==="soccer"?"soccer/"+league:CONFIG[sport].path;
  const base=ESPN+path;
  const notes=[],diagnostics={
    upstreamRequests:0,offenseSchedules:0,offenseBoxscores:0,
    missingOffenseBoxscores:0,defenseSchedules:0,defenseBoxscores:0,
    missingDefenseBoxscores:0,defenseProfiles:0
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
    const selectedDate=event.date;
    if(!Number.isFinite(Date.parse(selectedDate)))return respond({error:"Game kickoff date unavailable."},422);
    const season=String(event.season?.year||date.slice(0,4));
    const firstYear=Number(season);
    const requestedSeason=query.get("historySeason");
    const historySeason=requestedSeason===null?firstYear:Number(requestedSeason);
    if(!Number.isInteger(historySeason)||historySeason<firstYear-2||
       historySeason>firstYear||!/^\\d{4}$/.test(String(historySeason))){
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
    for(const t of teams){
      t.targetOpponentId=teams.find(x=>x.id!==t.id).id;
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
    for(const t of teams){
      for(const g of (histories.get(t.id)||[]).slice(0,COMPARABLE_CANDIDATES)){
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
    for(const t of teams){
      const upcomingDefense=t.targetOpponentId;
      const schedule=byTeamSchedule.get(upcomingDefense);
      if(schedule&&isCurrentSeason){
        demands.push({
          defenseId:upcomingDefense,kind:"target",eventId:null,
          games:historicGames(schedule,upcomingDefense,selectedDate,historySeason,sport,TARGET_PROFILE_GAMES)
        });
      }
      for(const past of (histories.get(t.id)||[]).slice(0,COMPARABLE_CANDIDATES)){
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

    const profiles={};
    for(const demand of demands){
      const complete=demand.games.filter(g=>summaryById.has(g.id))
        .map(g=>({id:g.id,summary:summaryById.get(g.id)}));
      const profile=buildPositionProfile(complete,sport,demand.defenseId,2);
      profiles[demand.defenseId]??={};
      if(demand.kind==="target")profiles[demand.defenseId].target=profile;
      else profiles[demand.defenseId][demand.eventId]=profile;
      if(Object.keys(profile).length)diagnostics.defenseProfiles++;
    }

    const trends=[];
    const normalizedRecords={};
    for(const t of teams){
      const records=(histories.get(t.id)||[]).filter(g=>summaryById.has(g.id))
        .map(g=>({...g,season:historySeason,
          players:extractBoxscore(summaryById.get(g.id),sport,t.id)}));
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
      sport,league,mode,count:trends.length,results:trends.slice(0,70),
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
