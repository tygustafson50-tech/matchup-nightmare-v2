/**
 * GET /api/scan?sport=nfl&date=YYYY-MM-DD&gameId=...&mode=similar|recent
 *
 * Scan only an actual selected scoreboard matchup, then look at previous
 * COMPLETED games for both participating teams. ESPN endpoints are unofficial.
 * No PrizePicks, sportsbook, or automatically verified alt line feed is present.
 */
import {
  CONFIG,SOCCER_LEAGUES,priorGames,extractBoxscore,defensiveAverage,scanTrends
} from "../../lib/auto-scan.js";

const ESPN="https://site.api.espn.com/apis/site/v2/sports/";
const MAX_PRIOR_GAMES=7;
const CONCURRENCY=5;

const respond=(data,status=200)=>new Response(JSON.stringify(data),{
  status,
  headers:{
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
async function jsonFrom(url){
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),9000);
  try{
    const response=await fetch(url,{signal:controller.signal,headers:{Accept:"application/json"}});
    if(!response.ok)throw Error("HTTP "+response.status);
    return await response.json();
  }finally{clearTimeout(timer);}
}
async function pool(items,fn){
  const out=new Array(items.length);
  let pos=0;
  await Promise.all(Array.from({length:Math.min(CONCURRENCY,items.length)},async()=>{
    while(pos<items.length){
      const index=pos++;
      try{out[index]={ok:true,value:await fn(items[index])};}
      catch(e){out[index]={ok:false,error:String(e.message).slice(0,100)};}
    }
  }));
  return out;
}
export async function onRequestGet({request}){
  const params=new URL(request.url).searchParams;
  const sport=params.get("sport")||"nfl";
  const date=params.get("date");
  const gameId=params.get("gameId")||"";
  const requestedMode=params.get("mode");
  const mode=requestedMode==="recent"?"recent":requestedMode==="similar"?"similar":"both";
  const league=sport==="soccer"?(params.get("league")||"eng.1"):CONFIG[sport]?.path?.split("/")[1];

  if(!Object.hasOwn(CONFIG,sport)||!validDate(date||"")||!/^\d{5,15}$/.test(gameId)){
    return respond({error:"Select a valid sport, date, and game from the schedule."},400);
  }
  if(sport==="soccer"&&!SOCCER_LEAGUES.has(league))return respond({error:"Unsupported soccer league"},400);
  const path=sport==="soccer"?"soccer/"+league:CONFIG[sport].path;
  const base=ESPN+path;
  const notes=[];
  const diagnostics={schedules:0,boxscores:0,boxscoreFailures:0,defenseSchedules:0,defenseFailures:0,teams:0};

  try{
    // Validate the game against that date's real scoreboard; never accept arbitrary IDs.
    const board=await jsonFrom(base+"/scoreboard?dates="+date.replaceAll("-","")+"&limit=100");
    const event=(board.events||[]).find(x=>String(x.id)===gameId);
    if(!event)return respond({error:"Selected game was not found on the verified date/league schedule."},404);
    const comp=event.competitions?.[0];
    const entries=comp?.competitors||[];
    if(entries.length!==2)return respond({error:"Team mapping unavailable for selected game."},422);
    const teams=entries.map(t=>({
      id:String(t.team?.id||""),
      name:t.team?.displayName||t.team?.name||"Unknown",
      logo:t.team?.logo||"",
      homeAway:t.homeAway
    }));
    if(teams.some(t=>!t.id||!/^\d+$/.test(t.id)))return respond({error:"Provider did not return stable team IDs."},422);
    diagnostics.teams=2;
    const selectedDate=event.date;
    const season=String(event.season?.year||date.slice(0,4));
    const scheduleByTeam={};
    const schedResults=await pool(teams,team=>jsonFrom(base+"/teams/"+team.id+"/schedule?season="+season+"&limit=100"));
    for(let i=0;i<teams.length;i++){
      if(schedResults[i].ok){
        scheduleByTeam[teams[i].id]=schedResults[i].value;
        diagnostics.schedules++;
      }else{
        notes.push(teams[i].name+": historic schedule unavailable");
      }
    }
    if(diagnostics.schedules===0){
      return respond({error:"Historical schedules unavailable. Can't produce a reliable scan.",notes,diagnostics},503);
    }
    const teamGames={};
    const history=[];
    for(const team of teams){
      team.targetOpponentId=teams.find(x=>x.id!==team.id).id;
      teamGames[team.id]=scheduleByTeam[team.id]
        ?priorGames(scheduleByTeam[team.id],team.id,selectedDate,MAX_PRIOR_GAMES):[];
      for(const h of teamGames[team.id])history.push(h);
    }

    const uniqueHistory=[...new Map(history.map(h=>[h.id,h])).values()];
    const boxes=await pool(uniqueHistory,game=>jsonFrom(base+"/summary?event="+game.id));
    const byGame={};
    for(let i=0;i<uniqueHistory.length;i++){
      if(boxes[i].ok){
        byGame[uniqueHistory[i].id]=boxes[i].value;
        diagnostics.boxscores++;
      }else diagnostics.boxscoreFailures++;
    }

    const defenses=new Map();
    if(mode!=="recent"){
      const opponents=new Set([...teams.map(t=>t.id),...history.map(h=>h.opponentId)]);
      const missing=[...opponents].filter(id=>!scheduleByTeam[id]);
      const profiles=await pool(missing,id=>jsonFrom(base+"/teams/"+id+"/schedule?season="+season+"&limit=100"));
      for(let i=0;i<missing.length;i++){
        if(profiles[i].ok){
          scheduleByTeam[missing[i]]=profiles[i].value;
          diagnostics.defenseSchedules++;
        }else diagnostics.defenseFailures++;
      }
    }

    const allProfiles={};
    if(mode!=="recent"){
      for(const team of teams){
        const opponent=team.targetOpponentId;
        allProfiles[opponent]??={};
        allProfiles[opponent].target=scheduleByTeam[opponent]
          ?defensiveAverage(scheduleByTeam[opponent],opponent,selectedDate):null;
        for(const record of teamGames[team.id]){
          allProfiles[record.opponentId]??={};
          allProfiles[record.opponentId][record.id]=scheduleByTeam[record.opponentId]
            ?defensiveAverage(scheduleByTeam[record.opponentId],record.opponentId,record.date):null;
        }
      }
    }

    const trends=[];
    for(const team of teams){
      if(!scheduleByTeam[team.id])continue;
      const records=teamGames[team.id].filter(g=>byGame[g.id]).map(g=>({
        ...g,players:extractBoxscore(byGame[g.id],sport,team.id)
      }));
      const inputs={id:gameId,date:selectedDate,sport};
      if(mode==="both"){
        trends.push(...scanTrends(records,team,inputs,allProfiles,"similar",3));
        trends.push(...scanTrends(records,team,inputs,allProfiles,"recent",3));
      }else{
        trends.push(...scanTrends(records,team,inputs,allProfiles,mode,3));
      }
    }
    if(!trends.length){
      notes.push("No 100% qualifying OVER thresholds found with at least 3 historical games and adequate source data.");
    }
    if(diagnostics.boxscoreFailures)notes.push("Some completed-game boxscores were unavailable; results are incomplete.");
    if(sport==="soccer")notes.push("Soccer player-level boxscores are often unavailable in this provisional source.");
    notes.push(mode==="recent"
      ?"Recent-game scan is not filtered for similar defenses."
      :"Comparable-defensive trends use historical TEAM scoring allowed (not defense against position). Recent-only results are labeled separately.");
    notes.push("Calculated thresholds are RESEARCH-ONLY. They are not verified PrizePicks or sportsbook offers.");
    notes.push("Historical 100% hit rates are not future winning probabilities.");

    return respond({
      game:{id:gameId,date:selectedDate,home:teams.find(t=>t.homeAway==="home"),
        away:teams.find(t=>t.homeAway==="away")},
      sport,league,mode,count:trends.length,
      results:trends.slice(0,70),notes,diagnostics,
      provider:"ESPN public scoreboard and boxscore (unofficial; no data availability guarantee)",
      refreshedAt:new Date().toISOString(),
      prizesPicksConnected:false,realOddsConnected:false
    });
  }catch(error){
    return respond({
      error:"Couldn't scan this game with the available historical provider.",
      details:String(error.message).slice(0,120),notes,diagnostics
    },502);
  }
}
