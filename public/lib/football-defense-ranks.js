/**
 * NFL matchup similarity: compare published ESPN opponent rushing and net
 * passing defensive ranks, one league rank at a time. This replaces the
 * old sampled per-position opponent-cohort model for NFL props only.
 *
 * ESPN's team /statistics results.opponent provide league rank for
 * 'rushingYards' and 'netPassingYards'. These are SEASON-TO-DATE for current
 * season and FULL-SEASON for past seasons, not pregame snapshots; the page
 * must disclose that limitation rather than pretending future data was known.
 */
const goodRank=n=>Number.isInteger(n)&&n>=1&&n<=32;
const goodValue=n=>typeof n==="number"&&Number.isFinite(n)&&n>=0;
const group=(arr,name)=>arr.find(x=>x?.name===name);
const findRank=(category,name)=>{
  const record=category?.stats?.find(s=>s?.name===name);
  if(!record||!goodRank(record.rank)||
     !goodValue(record.perGameValue))return null;
  return {rank:record.rank,yardsPerGame:
    Math.round(record.perGameValue*10)/10,
    statName:name,rankDisplay:String(record.rankDisplayValue||record.rank)};
};
function checkYear(p,requested){
  const explicit=p?.requestedSeason??p?.season;
  const year=typeof explicit==="object"?explicit?.year:explicit;
  return year==null||year===""||Number(year)===Number(requested);
}
export function parseFootballDefenseRanks(payload,{season,teamId}={}){
  if(!checkYear(payload,season))return null;
  if(payload?.team?.id &&
    String(payload.team.id)!==String(teamId))return null;
  const opp=payload?.results?.opponent;
  if(!Array.isArray(opp))return null;
  const rush=findRank(group(opp,"rushing"),"rushingYards");
  const pass=findRank(group(opp,"passing"),"netPassingYards");
  // Require BOTH real categories to keep an honest rank comparison,
  // rather than inferring a passing rank from a rushing metric.
  if(!rush||!pass)return null;
  return {teamId:String(teamId),season:Number(season),rushing:rush,
    passing:pass,source:"ESPN opponent team statistics",
    scope:"season aggregate (not pregame)"};
}
export function footballDefenseLane(stat){
  return ["rushingYards","rushAttempts","rushingTDs"].includes(stat)?"rushing":
    ["passingYards","passCompletions","passAttempts","passingTDs",
      "receptions","receivingYards","targets","receivingTDs"].includes(stat)
      ?"passing":null;
}
/** +/- 3 defensive rank places, true 1..32 ordinal rank, 1 strongest. */
export const DEFENSE_RANK_BAND=3;
export function compareFootballDefenseRanks(target,historical,stat,{band=DEFENSE_RANK_BAND}={}){
  const lane=footballDefenseLane(stat),t=target?.[lane],h=historical?.[lane];
  if(!lane||!target||!historical||!t||!h||
     !goodRank(t.rank)||!goodRank(h.rank))
    return {ok:false,reason:"Verified NFL rush/pass defensive ranks unavailable."};
  const gap=Math.abs(t.rank-h.rank);
  if(gap>band)return {ok:false,reason:"Defense rank outside +/- "+band+" positions."};
  return {ok:true,rankDifference:gap,rankLane:lane,
    targetRank:t.rank,historicalRank:h.rank,
    score:Math.round(100*(1-gap/(band+1))),
    context:"ESPN "+lane+" defense #"+h.rank+" in "+historical.season+
      " vs upcoming opponent #"+t.rank+" in "+target.season+
      " (difference "+gap+"; within ±"+band+
      "). Season aggregate rankings; previous-season final rankings "+
      "can include games played after the historical matchup."};
}
