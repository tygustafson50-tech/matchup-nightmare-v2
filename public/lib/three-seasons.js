/**
 * Collect position-specific, pregame comparisons from the selected season
 * and two previous seasons. This module is shared by all SIX sports.
 *
 * The response from each /api/scan?historySeason=... request is a bounded
 * and traceable snapshot of source data, NOT a separate 100%-hit-rate pick.
 * We calculate hit rates only AFTER combining all available seasons.
 */
import { scanTrends } from "./auto-scan.js";

export function seasonsFor(selectedSeason,window=3){
  const season=Number(selectedSeason);
  if(!Number.isInteger(season)||season<1900||season>2100)throw Error("Invalid selected season.");
  if(window!==1&&window!==3)throw Error("History window must be one or three seasons.");
  return Array.from({length:window},(_,i)=>season-i);
}
const validDate = value => {
  const time=Date.parse(value);
  return Number.isFinite(time);
};
const unique = array => [...new Set(array)];

export function combineSeasonBatches(responses,{
  sport,mode="both",window=3
}={}){
  if(!Array.isArray(responses)||!responses.length)throw Error("No historical seasons returned.");
  const current=responses.find(r=>r?.isCurrentSeason===true&&r?.seasonBatch);
  if(!current)throw Error("Current-season game history is unavailable; can't verify eligible players.");
  if(current.sport!==sport)throw Error("Sport does not match the selected game.");
  const game=current.game;
  if(!game?.id||!game.date||!validDate(game.date))throw Error("Selected game information is incomplete.");
  const selectedSeason=Number(current.selectedSeason);
  const expected=seasonsFor(selectedSeason,window);

  const eligible=responses.filter(r=>{
    const b=r?.seasonBatch;
    return b&&r.sport===sport&&r.game?.id===game.id&&
      Number(r.selectedSeason)===selectedSeason&&expected.includes(Number(b.season));
  });
  const bySeason=new Map();
  for(const entry of eligible){
    const season=Number(entry.seasonBatch.season);
    if(!bySeason.has(season))bySeason.set(season,entry);
  }
  if(!bySeason.has(selectedSeason))throw Error("Selected-season history could not be loaded.");

  const loaded=expected.filter(y=>bySeason.has(y));
  const missing=expected.filter(y=>!bySeason.has(y));
  const profiles={};
  const collected={};
  const teams=current.seasonBatch.teams||[];
  for(const t of teams){
    if(!t?.id||!t?.targetOpponentId)throw Error("Team identifiers are incomplete.");
    collected[t.id]=[];
  }
  const warnings=[];
  let missingBoxscores=0;
  for(const year of loaded){
    const response=bySeason.get(year);
    const batch=response.seasonBatch;
    for(const [id,record] of Object.entries(batch.defenseProfiles||{})){
      if(!profiles[id])profiles[id]={};
      for(const [key,val] of Object.entries(record||{})){
        // Current-game defensive strength is ALWAYS from the selected
        // season, never stale season averages substituted as current.
        if(key==="target"){
          if(year===selectedSeason)profiles[id].target=val;
        } else {
          profiles[id][key]=val;
        }
      }
    }
    for(const t of teams){
      const rows=batch.records?.[t.id]||[];
      for(const row of rows){
        if(!row?.id||!validDate(row.date)||Date.parse(row.date)>=Date.parse(game.date)||
          Number(row.season)!==year||!Array.isArray(row.players))continue;
        collected[t.id].push(row);
      }
    }
    const d=response.diagnostics||{};
    missingBoxscores+=(d.missingOffenseBoxscores||0)+(d.missingDefenseBoxscores||0);
    if(d.offenseSchedules<2)warnings.push(year+": one or more team schedules unavailable.");
    if(d.missingOffenseBoxscores||d.missingDefenseBoxscores)
      warnings.push(year+": some historical player/defense boxscores were unavailable.");
    if(d.upstreamRequests>=46)
      warnings.push(year+": source request cap reached; historical coverage is partial.");
  }
  if(missing.length)warnings.push("Historical seasons not loaded: "+missing.join(", ")+".");
  if(missingBoxscores)warnings.push("Missing source boxscores were excluded, never changed to zero.");

  const results=[];
  let currentRosterEvidenceCount=0;
  for(const team of teams){
    const perTeam=collected[team.id];
    // Only include athletes seen for this team in at least one of the most
    // recent three current-season matches. This is evidence of recent
    // affiliation, NOT a verified current game roster or injury status.
    const recentCurrent=(current.seasonBatch.records?.[team.id]||[])
      .filter(r=>validDate(r.date)&&Date.parse(r.date)<Date.parse(game.date))
      .sort((a,b)=>Date.parse(b.date)-Date.parse(a.date)).slice(0,3);
    const eligibleIds=new Set(recentCurrent.flatMap(r=>(r.players||[]).map(p=>String(p.id||"")).filter(Boolean)));
    currentRosterEvidenceCount+=eligibleIds.size;
    if(eligibleIds.size===0){
      warnings.push(team.name+": no recent team appearances available to establish player eligibility.");
      continue;
    }
    const seen=new Set();
    const records=perTeam.sort((a,b)=>Date.parse(b.date)-Date.parse(a.date))
      .filter(r=>{
        const k=String(r.id);
        if(seen.has(k))return false;
        seen.add(k);
        return true;
      }).map(r=>({...r,players:r.players.filter(p=>eligibleIds.has(String(p.id)))}))
      .filter(r=>r.players.length>0);
    const sourceEvent={id:game.id,date:game.date,sport};
    if(mode==="both"){
      results.push(...scanTrends(records,team,sourceEvent,profiles,"similar",3));
      results.push(...scanTrends(records,team,sourceEvent,profiles,"recent",3));
    }else{
      results.push(...scanTrends(records,team,sourceEvent,profiles,mode,3));
    }
  }

  const uniqueNotes=unique(warnings);
  uniqueNotes.push("Only players seen in recent current-season team games are included; this does not verify future rosters or injury availability.");
  uniqueNotes.push("Historical defense schemes, coaching, roles and opponent quality may change between seasons.");
  uniqueNotes.push("Calculated thresholds are RESEARCH ONLY, not verified PrizePicks lines or probabilities.");
  for(const pick of results){
    pick.seasonsRequested=expected;
    pick.seasonsLoaded=loaded;
    pick.coveragePartial=missing.length>0||missingBoxscores>0;
  }
  return {
    game,sport,mode,
    count:results.length,results,
    yearsRequested:expected,yearsLoaded:loaded,yearsMissing:missing,
    rosterEvidencePlayers:currentRosterEvidenceCount,
    notes:uniqueNotes,
    provider:"ESPN provisional historical player and position-concession boxscores",
    prizesPicksConnected:false,realOddsConnected:false
  };
}
