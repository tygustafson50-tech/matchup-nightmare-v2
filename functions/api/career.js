/**
 * Bounded historical career lookup across former teams:
 * /api/career?sport=nfl&gameId=...&date=...&playerId=...&season=...
 *
 * Not a sportsbook feed. ESPN's unofficial athlete gamelog discovers old
 * games regardless of the player's present franchise; summary boxscores
 * verify their actual team, stats and positional opponent.
 */
import {
  CONFIG,SOCCER_LEAGUES,priorGames,buildPositionProfile,
  extractBoxscore,rosterPositionIndex,attachRosterPositions,matchupRole
} from "../../lib/auto-scan.js";
import {
  parseCareerEventRefs,seasonFromDate,athleteCareerAppearance
} from "../../lib/career-history.js";

const SCORE="https://site.api.espn.com/apis/site/v2/sports/";
const ATHLETES="https://site.web.api.espn.com/apis/common/v3/sports/";
const LIMIT=44,MAX_GAMELOG_REFS=100,MAX_CAREER_GAMES=8,DEFENSE_CANDIDATES=6;
const send=(data,status=200)=>new Response(JSON.stringify(data),{
  status,headers:{"content-type":"application/json; charset=utf-8",
    "cache-control":status===200?"public, max-age=300":"no-store",
    "x-content-type-options":"nosniff"}
});
const matchDate=value=>/^\d{4}-\d{2}-\d{2}$/.test(value||"") &&
  !Number.isNaN(Date.parse(value+"T00:00:00Z"));
async function fetchPool(items,fn){
  const out=new Array(items.length);let next=0;
  await Promise.all(Array.from({length:Math.min(4,items.length)},async()=>{
    while(next<items.length){
      const i=next++;
      try{out[i]={ok:true,value:await fn(items[i])};}
      catch(error){out[i]={ok:false,error:String(error.message).slice(0,120)};}
    }
  }));
  return out;
}
function fetcher(stats){
  const memo=new Map();
  return function fetchJson(url){
    if(memo.has(url))return memo.get(url);
    if(stats.requests>=LIMIT)return Promise.reject(Error("Career scan request cap reached."));
    stats.requests++;
    const promise=(async()=>{
      const ctrl=new AbortController();
      const timer=setTimeout(()=>ctrl.abort(),9000);
      try{
        const response=await fetch(url,{signal:ctrl.signal,headers:{Accept:"application/json"}});
        if(!response.ok)throw Error("HTTP "+response.status);
        return await response.json();
      }finally{clearTimeout(timer);}
    })();
    memo.set(url,promise);
    return promise;
  };
}
export async function onRequestGet({request}){
  const q=new URL(request.url).searchParams;
  const sport=q.get("sport")||"",date=q.get("date")||"",
    gameId=q.get("gameId")||"",playerId=q.get("playerId")||"",
    year=Number(q.get("season"));
  const skipText=q.get("skip")||"";
  if(skipText&&!/^\d{5,15}(,\d{5,15}){0,30}$/.test(skipText))
    return send({error:"Invalid known-game exclusions."},400);
  const known=new Set(skipText?skipText.split(","):[]);
  if(!Object.hasOwn(CONFIG,sport)||!matchDate(date)||!/^\d{5,15}$/.test(gameId)||
    !/^\d{2,15}$/.test(playerId)||!Number.isInteger(year)||year<1900||year>2100)
    return send({error:"Select a valid game, career player and historical season."},400);
  const league=sport==="soccer"?(q.get("league")||"eng.1"):CONFIG[sport].path.split("/")[1];
  if(sport==="soccer"&&!SOCCER_LEAGUES.has(league))return send({error:"Unknown soccer league."},400);
  const path=sport==="soccer"?"soccer/"+league:CONFIG[sport].path;
  const gameBase=SCORE+path,athleteBase=ATHLETES+path;
  const stats={requests:0,gamelogEvents:0,verifiedAppearances:0,
    opponentProfiles:0,sourceFailures:0,rosterLookups:0,
    rostersWithPositions:0,careerPositionsResolved:0,careerPositionsMissing:0};
  const get=fetcher(stats),warnings=[];
  try{
    const board=await get(gameBase+"/scoreboard?dates="+date.replaceAll("-","")+"&limit=100");
    const fixture=(board?.events||[]).find(e=>String(e.id)===gameId);
    if(!fixture)return send({error:"Selected event was not found on the requested date."},404);
    const kickoff=fixture.date,selectedYear=Number(
      fixture.season?.year??seasonFromDate(sport,kickoff)
    );
    if(!kickoff||!Number.isFinite(Date.parse(kickoff))||
      !Number.isInteger(selectedYear)||year>selectedYear||year<selectedYear-2)
      return send({error:"Career game logs support the selected season and the two preceding seasons."},400);
    const gamelogUrl=athleteBase+"/athletes/"+playerId+"/gamelog?season="+year;
    let gameLog;
    try{gameLog=await get(gamelogUrl);}
    catch(error){
      return send({
        sport,gameId,playerId,season:year,
        careerBatch:{season:year,playerId,records:[],defenseProfiles:{},
          sourceStatus:"unavailable"},
        diagnostics:stats,warnings:["Historical athlete gamelog unavailable: "+String(error.message)],
        provider:"ESPN athlete gamelog (unofficial)"
      });
    }
    const discovered=parseCareerEventRefs(gameLog,year,kickoff,MAX_GAMELOG_REFS);
    const references=discovered.filter(g=>!known.has(g.id)).slice(0,MAX_CAREER_GAMES);
    stats.gamelogEvents=discovered.length;
    stats.knownGamesSkipped=discovered.filter(g=>known.has(g.id)).length;
    stats.extraGameCandidates=references.length;
    if(!discovered.length)warnings.push("No athlete game IDs exposed by the provider for this season.");
    const completed=await fetchPool(references,g=>get(gameBase+"/summary?event="+g.id));
    const appearances=[];
    for(let i=0;i<completed.length;i++){
      if(!completed[i].ok){stats.sourceFailures++;continue;}
      const row=athleteCareerAppearance(completed[i].value,sport,playerId,
        references[i].id,year,references[i].date);
      if(row && Date.parse(row.date)<Date.parse(kickoff))
        appearances.push(row);
    }
    appearances.sort((a,b)=>Date.parse(b.date)-Date.parse(a.date));
    stats.verifiedAppearances=appearances.length;
    const defenseProfiles={};
    const chosen=appearances.slice(0,DEFENSE_CANDIDATES);
    // Actual defender is read from the historical game, NOT assumed to be
    // the player's current team's opponent or its present defensive roster.
    const uniqueOpponents=[...new Set(chosen.map(g=>g.opponentId))];
    const schedules=await fetchPool(uniqueOpponents,id=>
      get(gameBase+"/teams/"+id+"/schedule?season="+year+"&limit=100"));
    const byDefense=new Map();
    for(let i=0;i<uniqueOpponents.length;i++){
      if(schedules[i].ok)byDefense.set(uniqueOpponents[i],schedules[i].value);
      else stats.sourceFailures++;
    }
    const historyById=new Map();
    const demands=[];
    for(const row of chosen){
      const schedule=byDefense.get(row.opponentId);
      if(!schedule)continue;
      const prior=priorGames(schedule,row.opponentId,row.date,2)
        .filter(g=>{
          const explicit=g.season;
          return explicit===null||explicit===undefined
            ?seasonFromDate(sport,g.date)===year:Number(explicit)===year;
        });
      demands.push({row,prior});
      for(const g of prior)historyById.set(g.id,g);
    }
    const hist=[...historyById.values()];
    const data=await fetchPool(hist,g=>get(gameBase+"/summary?event="+g.id));
    const box=new Map();
    for(let i=0;i<hist.length;i++){
      if(data[i].ok)box.set(hist[i].id,data[i].value);
      else stats.sourceFailures++;
    }
    // Historical ESPN boxscore rows often lack positions. Verify roles from
    // the correct historical season's team roster, prioritizing the actual
    // team the athlete played for and then defender-opponent offensive teams.
    const rosterNeeded=new Map();
    function want(id,priority){
      const key=String(id||"");
      if(!/^\d+$/.test(key))return;
      if(!rosterNeeded.has(key)||rosterNeeded.get(key)>priority)
        rosterNeeded.set(key,priority);
    }
    for(const app of appearances){
      if(!app.players[0]?.position)want(app.playedTeamId,0);
    }
    if(sport!=="mlb"){
      for(const {row,prior} of demands){
        for(const g of prior){
          const summary=box.get(g.id);
          if(!summary)continue;
          for(const t of summary.boxscore?.players||[]){
            const id=String(t.team?.id||"");
            if(id===String(row.opponentId))continue;
            const athletes=extractBoxscore(summary,sport,id);
            if(athletes.some(p=>(CONFIG[sport]?.markets||[]).some(([stat])=>
              Number.isFinite(p.stats?.[stat])&&!matchupRole(sport,p.position,stat))))
              want(id,1);
          }
        }
      }
    }
    const wanted=[...rosterNeeded].sort((a,b)=>a[1]-b[1]).map(x=>x[0]);
    const capacity=Math.max(0,Math.min(10,LIMIT-stats.requests-1));
    const looks=await fetchPool(wanted.slice(0,capacity),id=>
      get(gameBase+"/teams/"+id+"/roster?season="+year));
    stats.rosterLookups=looks.length;
    const rosterIndices={};
    for(let i=0;i<looks.length;i++){
      if(!looks[i].ok)continue;
      const id=wanted[i],positions=rosterPositionIndex(looks[i].value,id);
      if(Object.keys(positions[id]||{}).length){
        rosterIndices[id]=positions[id];
        stats.rostersWithPositions++;
      }
    }
    // Re-resolve original game appearances after attaching verified hints,
    // retaining the same athlete ID, historical team, date and true stat.
    for(let i=0;i<completed.length;i++){
      if(!completed[i].ok)continue;
      const enriched=attachRosterPositions(completed[i].value,rosterIndices);
      const updated=athleteCareerAppearance(enriched,sport,playerId,
        references[i].id,year,references[i].date);
      if(!updated)continue;
      const existing=appearances.findIndex(x=>x.id===updated.id);
      if(existing>=0)appearances[existing]=updated;
    }
    for(const [id,summary] of box)box.set(id,attachRosterPositions(summary,rosterIndices));
    stats.careerPositionsResolved=appearances.filter(x=>x.players[0]?.position).length;
    stats.careerPositionsMissing=appearances.length-stats.careerPositionsResolved;
    for(const {row,prior} of demands){
      const valid=prior.filter(g=>box.has(g.id)).map(g=>({id:g.id,summary:box.get(g.id)}));
      const profile=buildPositionProfile(valid,sport,row.opponentId,2);
      defenseProfiles[row.opponentId]??={};
      defenseProfiles[row.opponentId][row.id]=profile;
      if(Object.keys(profile).length)stats.opponentProfiles++;
    }
    if(stats.sourceFailures)warnings.push("Some career events or defensive boxscores were unavailable.");
    if(stats.careerPositionsMissing)
      warnings.push(stats.careerPositionsMissing+" career game appearances lacked a verified position and cannot establish a defense-vs-position trend.");
    if(wanted.length>stats.rosterLookups)
      warnings.push("Some career roster lookups were skipped to stay within free-plan request limits.");
    if(stats.requests>=LIMIT)warnings.push("Career scan reached the per-request free-tier budget.");
    if(sport==="soccer")warnings.push("Soccer career history is limited to the selected league; moves between leagues may be omitted.");
    warnings.push("Career lookup checks up to eight additional verifiable appearances per season (after skipping known team games), with up to six opponent defensive profiles; it is not a complete-season archive.");
    return send({
      sport,gameId,playerId,season:year,
      careerBatch:{season:year,playerId,records:appearances,
        defenseProfiles,sourceStatus:references.length?"partial":"unavailable"},
      diagnostics:stats,warnings,
      provider:"ESPN athlete career gamelogs and completed boxscores (unofficial)"
    });
  }catch(error){
    return send({error:"Career source failed.",details:String(error.message).slice(0,140),
      diagnostics:stats},502);
  }
}
