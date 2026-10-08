/**
 * Browser-side former-team career verification. Uses one-resource Cloudflare
 * proxy calls instead of a CPU-heavy career Pages Function.
 */
import {
  priorGames,buildPositionProfile,rosterPositionIndex,
  attachRosterPositions,extractBoxscore,matchupRole,CONFIG
} from "./auto-scan.js";
import {parseCareerEventRefs,athleteCareerAppearance} from "./career-history.js";

const MAX_EXTRA_GAME_IDS=8,MAX_DEFENSIVE_OPPONENTS=4;
const asText=e=>String(e?.message||e).slice(0,150);
export async function loadCareerFromEspn({
  client,sport,league="eng.1",game,player,season,knownIds=[]
}={}){
  if(!client||!CONFIG[sport]||!game?.id||!player?.playerId||
      !/^\d{1,15}$/.test(String(player.playerId))||
      !Number.isInteger(Number(season)))
    throw Error("Incomplete athlete career request.");
  const year=Number(season);
  const common={sport,...(sport==="soccer"?{league}:{})};
  const warnings=[],diagnostics={
    gamelogEvents:0,knownGamesSkipped:0,verifiedAppearances:0,
    opponentProfiles:0,sourceFailures:0,rosterLookups:0,
    rostersWithPositions:0
  };
  const known=new Set(knownIds.map(String));
  const empty=(status)=>({
    sport,gameId:String(game.id),playerId:String(player.playerId),season:year,
    careerBatch:{season:year,playerId:String(player.playerId),
      records:[],defenseProfiles:{},sourceStatus:status},
    warnings,diagnostics
  });
  let gamelog;
  try{
    gamelog=await client.source({...common,kind:"gamelog",
      playerId:String(player.playerId),season:String(year)});
  }catch(error){
    warnings.push("Historical athlete gamelog source unavailable: "+asText(error));
    return empty("unavailable");
  }
  const discovered=parseCareerEventRefs(gamelog,year,game.date,120);
  diagnostics.gamelogEvents=discovered.length;
  diagnostics.knownGamesSkipped=discovered.filter(x=>known.has(x.id)).length;
  const requests=discovered.filter(g=>!known.has(g.id))
    .slice(0,MAX_EXTRA_GAME_IDS);
  const replies=await Promise.allSettled(requests.map(g=>
    client.source({...common,kind:"summary",gameId:g.id})));
  const rawMatches=[];
  for(let i=0;i<requests.length;i++){
    if(replies[i].status!=="fulfilled"){
      diagnostics.sourceFailures++;continue;
    }
    const actual=athleteCareerAppearance(replies[i].value,sport,
      player.playerId,requests[i].id,year,requests[i].date);
    if(actual)rawMatches.push({record:actual,summary:replies[i].value});
  }
  // If an old team has no position in a stat row, a roster for that actual
  // season/team can supply position metadata; never infer a role from yards.
  const selectedTeams=[...new Set(rawMatches.filter(x=>
    !x.record.players[0]?.position).map(x=>x.record.playedTeamId))]
    .slice(0,3);
  const rosterRes=await Promise.allSettled(selectedTeams.map(teamId=>
    client.source({...common,kind:"roster",teamId,season:String(year)})));
  const positions={};
  for(let i=0;i<rosterRes.length;i++){
    diagnostics.rosterLookups++;
    if(rosterRes[i].status==="fulfilled"){
      const teamId=selectedTeams[i],index=rosterPositionIndex(rosterRes[i].value,teamId);
      if(Object.keys(index[teamId]||{}).length){
        positions[teamId]=index[teamId];diagnostics.rostersWithPositions++;
      }
    }
  }
  const appearances=[];
  for(const entry of rawMatches){
    const enhanced=attachRosterPositions(entry.summary,positions);
    const found=athleteCareerAppearance(enhanced,sport,player.playerId,
      entry.record.id,year,entry.record.date);
    if(found)appearances.push(found);
  }
  diagnostics.verifiedAppearances=appearances.length;
  const chosen=appearances.slice(0,MAX_DEFENSIVE_OPPONENTS);
  const opponentIds=[...new Set(chosen.map(r=>r.opponentId))];
  const scheduleResults=await Promise.allSettled(opponentIds.map(teamId=>
    client.source({...common,kind:"schedule",
      teamId,season:String(year)})));
  const schedules=new Map();
  for(let i=0;i<opponentIds.length;i++){
    if(scheduleResults[i].status==="fulfilled")
      schedules.set(opponentIds[i],scheduleResults[i].value);
    else warnings.push("Old opponent "+opponentIds[i]+
      " schedule unavailable; missing defense excluded.");
  }
  const demands=[],games=new Map();
  for(const row of chosen){
    const schedule=schedules.get(row.opponentId);
    if(!schedule)continue;
    const old=priorGames(schedule,row.opponentId,row.date,180)
      .filter(g=>g.season===null||g.season===undefined||
        Number(g.season)===year).slice(0,2);
    demands.push({row,games:old});
    for(const g of old)games.set(String(g.id),g);
  }
  const ids=[...games.keys()];
  const historic=await Promise.allSettled(ids.map(gameId=>
    client.source({...common,kind:"summary",gameId})));
  const boxes=new Map();
  for(let i=0;i<ids.length;i++){
    if(historic[i].status==="fulfilled")boxes.set(ids[i],historic[i].value);
    else diagnostics.sourceFailures++;
  }
  // For defense profiles, the opponent's OFFENSIVE players must have
  // verified positions, using the season-specific roster where necessary.
  const need=new Set();
  for(const {row,games:old} of demands){
    for(const g of old){
      const summary=boxes.get(String(g.id));
      if(!summary||sport==="mlb")continue;
      for(const club of summary.boxscore?.players||[]){
        const teamId=String(club.team?.id||"");
        if(teamId===row.opponentId)continue;
        const players=extractBoxscore(summary,sport,teamId);
        if(players.some(p=>CONFIG[sport].markets.some(([stat])=>
          Number.isFinite(p.stats?.[stat])&&!matchupRole(sport,p.position,stat))))
          need.add(teamId);
      }
    }
  }
  const rosterIds=[...need].slice(0,5);
  const defenseRosters=await Promise.allSettled(rosterIds.map(teamId=>
    client.source({...common,kind:"roster",teamId,season:String(year)})));
  const rosterMap={...positions};
  for(let i=0;i<rosterIds.length;i++){
    diagnostics.rosterLookups++;
    if(defenseRosters[i].status==="fulfilled"){
      const id=rosterIds[i],index=rosterPositionIndex(defenseRosters[i].value,id);
      if(Object.keys(index[id]||{}).length){
        rosterMap[id]=index[id];diagnostics.rostersWithPositions++;
      }
    }
  }
  for(const [id,raw] of boxes)
    boxes.set(id,attachRosterPositions(raw,rosterMap));
  const defenseProfiles={};
  for(const d of demands){
    const sample=d.games.filter(g=>boxes.has(String(g.id)))
      .map(g=>({id:String(g.id),summary:boxes.get(String(g.id))}));
    const profile=buildPositionProfile(sample,sport,d.row.opponentId,2);
    if(Object.keys(profile).length){
      defenseProfiles[d.row.opponentId]??={};
      defenseProfiles[d.row.opponentId][d.row.id]=profile;
      diagnostics.opponentProfiles++;
    }
  }
  if(discovered.length>requests.length+diagnostics.knownGamesSkipped)
    warnings.push("Career feed sampled "+requests.length+
      " additional event IDs; this is not the athlete's entire season.");
  if(diagnostics.sourceFailures)
    warnings.push("Some historical boxscores were unavailable; they were not counted as misses.");
  if(!appearances.length)
    warnings.push("No additional verified old-team game appearances were returned for this athlete.");
  return {
    sport,gameId:String(game.id),playerId:String(player.playerId),season:year,
    careerBatch:{
      season:year,playerId:String(player.playerId),records:appearances,
      defenseProfiles,sourceStatus:"partial"
    },warnings,diagnostics,
    provider:"ESPN verified old-game summaries and opponent pregame records"
  };
}
