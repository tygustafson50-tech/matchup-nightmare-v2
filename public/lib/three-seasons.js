/**
 * Collect position-specific, pregame comparisons from the selected season
 * and two previous seasons. This module is shared by all SIX sports.
 *
 * The response from each /api/scan?historySeason=... request is a bounded
 * and traceable snapshot of source data, NOT a separate 100%-hit-rate pick.
 * We calculate hit rates only AFTER combining all available seasons.
 */
import { buildMatchupCards } from "./matchup-trends.js";

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
  sport,mode="both",window=3,careerBatches=[],careerEligibleCount=0
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

  // An API response without usable player statistics is not evidence that
  // its historical season was actually scanned successfully.
  const hasUsableGames=entry=>Object.values(entry?.seasonBatch?.records||{})
    .some(rows=>Array.isArray(rows)&&rows.some(row=>
      Array.isArray(row.players)&&row.players.some(p=>
        Object.values(p.stats||{}).some(Number.isFinite))));
  const loaded=expected.filter(y=>bySeason.has(y)&&hasUsableGames(bySeason.get(y)));
  const missing=expected.filter(y=>!loaded.includes(y));
  const profiles={};
  const collected={};
  const teams=current.seasonBatch.teams||[];
  for(const t of teams){
    if(!t?.id||!t?.targetOpponentId)throw Error("Team identifiers are incomplete.");
    collected[t.id]=[];
  }
  const warnings=[];
  const positionCoverage={rosterLookups:0,rostersWithPositions:0,
    missingPositionRows:0,resolvedPositionRows:0,defenseProfileStatTypes:0};
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
    positionCoverage.rosterLookups+=(d.rosterLookups||0);
    positionCoverage.rostersWithPositions+=(d.rosterLookupsSucceeded||0);
    positionCoverage.missingPositionRows+=(d.positionRowsMissing||0);
    positionCoverage.resolvedPositionRows+=(d.positionRowsResolved||0);
    positionCoverage.defenseProfileStatTypes+=(d.defenseProfileStatTypes||0);
    missingBoxscores+=(d.missingOffenseBoxscores||0)+(d.missingDefenseBoxscores||0);
    if(d.offenseSchedules<2)warnings.push(year+": one or more team schedules unavailable.");
    if(d.missingOffenseBoxscores||d.missingDefenseBoxscores)
      warnings.push(year+": some historical player/defense boxscores were unavailable.");
    if(d.upstreamRequests>=46)
      warnings.push(year+": source request cap reached; historical coverage is partial.");
  }
  if(missingBoxscores)warnings.push("Missing source boxscores were excluded, never changed to zero.");

  // Career log supplements are attached to the athlete's CURRENT team for
  // output, even if that player represented a completely different franchise
  // in the old game. Opponent/team IDs come from verified old box scores.
  const careerByPlayer=new Map(),loadedCareerYears=new Set();
  const eligiblePlayers=new Map();
  for(const team of teams){
    const recent=(current.seasonBatch.records?.[team.id]||[])
      .filter(r=>validDate(r.date)&&Date.parse(r.date)<Date.parse(game.date))
      .sort((a,b)=>Date.parse(b.date)-Date.parse(a.date)).slice(0,3);
    eligiblePlayers.set(team.id,new Set(recent.flatMap(r=>(r.players||[])
      .map(p=>String(p.id||"")).filter(Boolean))));
  }
  for(const item of Array.isArray(careerBatches)?careerBatches:[]){
    const old=item?.careerBatch;
    const teamId=String(item?.forTeamId||""),athleteId=String(old?.playerId||"");
    const season=Number(old?.season);
    if(!teams.some(t=>t.id===teamId) ||
      !eligiblePlayers.get(teamId)?.has(athleteId) ||
      !expected.includes(season)||
      item.sport!==sport||String(item.gameId)!==String(game.id) ||
      String(item.playerId)!==athleteId)continue;
    const key=teamId+":"+athleteId;
    const info=careerByPlayer.get(key)||{requested:[],loaded:[],teams:new Set(),errors:[]};
    if(!info.requested.includes(season))info.requested.push(season);
    let usable=0;
    for(const row of old.records||[]){
      if(!row||!row.id||!validDate(row.date)||
        Date.parse(row.date)>=Date.parse(game.date)||Number(row.season)!==season||
        !Array.isArray(row.players)||!row.players.some(p=>String(p.id)===athleteId))continue;
      const only=row.players.filter(p=>String(p.id)===athleteId);
      collected[teamId].push({...row,players:only,careerSource:"athlete-gamelog"});
      if(row.playedTeamId && String(row.playedTeamId)!==teamId)info.teams.add(String(row.playedTeamId));
      usable++;
    }
    if(usable){
      loadedCareerYears.add(season);
      if(!info.loaded.includes(season))info.loaded.push(season);
    }
    if(old.sourceStatus!=="complete" || (item.warnings||[]).length){
      info.errors.push("Player-level historical source coverage is incomplete");
    }
    // Do not replace the current selected opponent's target profile with
    // historical year data. Histories are indexed by actual OLD game ID.
    for(const [defenseId,values] of Object.entries(old.defenseProfiles||{})){
      profiles[defenseId]??={};
      for(const [eventId,metric] of Object.entries(values||{})){
        if(eventId==="target")continue;
        profiles[defenseId][eventId]=metric;
      }
    }
    careerByPlayer.set(key,info);
  }
  const scannedSeasons=expected.filter(y=>loaded.includes(y)||loadedCareerYears.has(y));
  const missingSeasons=expected.filter(y=>!scannedSeasons.includes(y));
  if(missingSeasons.length)
    warnings.push("Historical seasons without usable current-team or verified career records: "+
      missingSeasons.join(", ")+".");
  const oldTeamsOnly=scannedSeasons.filter(y=>!loaded.includes(y));
  if(oldTeamsOnly.length)
    warnings.push("Verified former-team records recovered for: "+oldTeamsOnly.join(", ")+".");
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
    const byEvent=new Map();
    for(const row of perTeam.sort((a,b)=>Date.parse(b.date)-Date.parse(a.date))){
      const players=(row.players||[]).filter(p=>eligibleIds.has(String(p.id)));
      if(!players.length)continue;
      // Two current teammates could have been on OPPOSING teams earlier,
      // and cannot be conflated into one game/opponent record.
      const key=String(row.id)+":"+String(row.playedTeamId||team.id);
      const old=byEvent.get(key);
      if(!old){
        byEvent.set(key,{...row,players:[...players]});
      }else{
        for(const athlete of players){
          if(!old.players.some(p=>String(p.id)===String(athlete.id)))
            old.players.push(athlete);
        }
      }
    }
    const records=[...byEvent.values()].sort((a,b)=>Date.parse(b.date)-Date.parse(a.date));
    // Selected league season is explicitly applied by scanTrends when
    // computing Last 5; old seasons are eligible ONLY for similar defenses.
    const sourceEvent={id:game.id,date:game.date,sport,season:selectedSeason};
    // A single unified card per athlete/market: the two histograms use the
    // SAME independently derived current-season research threshold.
    // Never calculate the line from the lowest comparable opponent result.
    const teamResults=buildMatchupCards(records,team,sourceEvent,profiles,{
      window,league:current.league||null
    });
    for(const pick of teamResults){
      const info=careerByPlayer.get(team.id+":"+pick.playerId);
      pick.careerTeamsIncluded=info?[...info.teams]:[];
      pick.careerSeasonsVerified=info?[...info.loaded].sort((a,b)=>b-a):[];
      pick.careerEnrichmentAttempted=!!info;
      pick.careerCoveragePartial=window===3 && (!info || info.errors.length>0 ||
        expected.slice(1).some(y=>!info.loaded.includes(y)));
    }
    results.push(...teamResults);
  }

  const uniqueNotes=unique(warnings);
  if(positionCoverage.missingPositionRows)
    uniqueNotes.push(positionCoverage.missingPositionRows+
      " sampled player stat rows lacked verified positions; comparable matchup calculations excluded these rows.");
  if(positionCoverage.rosterLookups)
    uniqueNotes.push("Position lookup: "+positionCoverage.rostersWithPositions+
      " verified roster responses out of "+positionCoverage.rosterLookups+" attempts.");
  uniqueNotes.push("Recent games show only the selected season; similar-defense history may span three seasons.");
  uniqueNotes.push("Career sources may include previous franchises, but only sampled games and verified boxscores are included.");
  if(careerEligibleCount && careerByPlayer.size<careerEligibleCount)
    uniqueNotes.push("Career enrichment covered "+careerByPlayer.size+" of "+careerEligibleCount+
      " eligible players. Players not enriched may have missing old-team matchups.");
  uniqueNotes.push("Only players seen in recent current-season team games are included; this does not verify future rosters or injury availability.");
  uniqueNotes.push("Historical defense schemes, coaching, roles and opponent quality may change between seasons.");
  uniqueNotes.push("OVER research lines are chosen independently from current-season form, never from comparable historical game results. No verified live PrizePicks/sportsbook feed is connected.");
  uniqueNotes.push("Injuries, current lineup roles, projected playing time and cross-league tactical adjustments are not independently verified by the present free data source.");
  for(const pick of results){
    pick.seasonsRequested=expected;
    pick.seasonsLoaded=scannedSeasons;
    pick.coveragePartial=missingSeasons.length>0||missingBoxscores>0||
      pick.careerCoveragePartial;
  }
  return {
    game,sport,mode,
    count:results.length,results,
    yearsRequested:expected,yearsLoaded:scannedSeasons,yearsMissing:missingSeasons,
    careerPlayersEnriched:careerByPlayer.size,careerEligibleCount,
    rosterEvidencePlayers:currentRosterEvidenceCount,
    positionCoverage,notes:uniqueNotes,
    provider:"ESPN provisional game logs with independently calculated position/stat defensive comparisons",
    matchupModel:"position-stat-three-season-v3",
    prizesPicksConnected:false,realOddsConnected:false
  };
}
