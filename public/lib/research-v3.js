/**
 * Matchup Nightmare V3: deterministic, evidence-only research engine.
 * NO invented lines, no projected performances, no forced 100% labels.
 * Input is exclusively verified current PropLine sportsbook quotes + recorded statistics
 * + pregame defensive features. Every sport uses stat- and position-specific
 * history, normalized against documented SAME-SEASON observed cohorts.
 */
import {compareFootballDefenseRanks} from "./football-defense-ranks.js";
export const SPORTS=Object.freeze(["nfl","nba","mlb","ncaaf","ncaab","soccer"]);
const NUMBER=x=>typeof x==="number"&&Number.isFinite(x);
const validDate=x=>typeof x==="string"&&Number.isFinite(Date.parse(x));
const squash=x=>String(x||"").toUpperCase().replace(/[^A-Z0-9]/g,"");
const FOOTBALL=new Set(["nfl","ncaaf"]);
const BASKETBALL=new Set(["nba","ncaab"]);
export function positionGroup(sport,position){
  const p=squash(position);
  if(FOOTBALL.has(sport)){
    if(["QB","QUARTERBACK"].includes(p))return "QB";
    if(["RB","HB","FB","RUNNINGBACK","FULLBACK"].includes(p))return "RB";
    if(["WR","WIDERECEIVER"].includes(p))return "WR";
    if(["TE","TIGHTEND"].includes(p))return "TE";
  }
  if(BASKETBALL.has(sport)){
    // Official ESPN college box scores often use G/F rather than PG/SG or
    // SF/PF. Grouping similar roles allows independently verified college
    // players to be matched without guessing their specific position.
    if(["PG","SG","G","POINTGUARD","SHOOTINGGUARD","GUARD",
      "COMBOGUARD","GF","FG"].includes(p))return "G";
    if(["SF","PF","F","SMALLFORWARD","POWERFORWARD","FORWARD",
      "FORWARDCENTER","FC"].includes(p))return "F";
    if(["C","CENTER"].includes(p))return "C";
  }
  if(sport==="mlb"){
    if(["P","SP","RP","CP","STARTINGPITCHER","PITCHER"].includes(p))return "P";
    if(["C","1B","2B","3B","SS","LF","CF","RF","OF","IF","DH"].includes(p))return "BATTER";
  }
  if(sport==="soccer"){
    if(["F","FW","ST","CF","LW","RW","FORWARD"].includes(p))return "F";
    if(["M","MF","CM","CDM","CAM","MIDFIELDER"].includes(p))return "M";
    if(["D","DF","CB","LB","RB","DEFENDER"].includes(p))return "D";
    if(["GK","GOALKEEPER"].includes(p))return "GK";
  }
  return null;
}
const MARKET_KEYS={
  nfl:new Set(["passingYards","passCompletions","passAttempts","passingTDs","rushingYards","rushAttempts","rushingTDs","receptions","receivingYards","targets","receivingTDs"]),
  ncaaf:new Set(["passingYards","passCompletions","passAttempts","passingTDs","rushingYards","rushAttempts","rushingTDs","receptions","receivingYards","targets","receivingTDs"]),
  nba:new Set(["points","rebounds","assists","threes","pra","steals","blocks"]),
  ncaab:new Set(["points","rebounds","assists","threes","pra","steals","blocks"]),
  mlb:new Set(["hits","totalBases","homeRuns","runs","rbis","walks","pitcherKs","pitchingOuts"]),
  soccer:new Set(["shots","shotsOnTarget","goals","assists","tackles","fouls","saves"])
};
export function supportsMarket(sport,position,stat){
  const role=positionGroup(sport,position);
  if(!role||!MARKET_KEYS[sport]?.has(stat))return false;
  if(sport==="mlb")return role==="P"
    ?["pitcherKs","pitchingOuts"].includes(stat)
    :!["pitcherKs","pitchingOuts"].includes(stat);
  return true;
}
export function seasonWindow(selectedSeason){
  const n=Number(selectedSeason);
  if(!Number.isInteger(n)||n<2000||n>2100)throw Error("Invalid league season.");
  return [n,n-1,n-2];
}
const nonnegative=n=>NUMBER(n)&&n>=0;
const evidenceRow=g=>({
  id:String(g.id),date:g.date,opponent:g.opponent,season:g.season,
  actual:g.actual,team:g.team,source:g.source
});
export function resultAtLine(actual,line){
  if(!nonnegative(actual)||!nonnegative(line))return "UNVERIFIED";
  return actual>line?"OVER":actual===line?"PUSH":"UNDER";
}
export function hitSummary(games,line){
  const rows=(Array.isArray(games)?games:[]).filter(g=>nonnegative(g.actual));
  const over=rows.filter(g=>g.actual>line).length;
  const push=rows.filter(g=>g.actual===line).length;
  return {hits:over,tracked:rows.length,pushes:push,
    percent:rows.length?Math.round(1000*over/rows.length)/10:null};
}
function uniqueGames(games){
  const seen=new Set();
  return (Array.isArray(games)?games:[])
    .filter(g=>g&&g.id&&validDate(g.date)&&nonnegative(g.actual)&&
      g.source&&g.opponent&&Number.isInteger(Number(g.season))&&
      (g.verified===true))
    .sort((a,b)=>Date.parse(b.date)-Date.parse(a.date))
    .filter(g=>{const k=g.id+"|"+g.playerId;
      if(seen.has(k))return false;seen.add(k);return true;});
}
/** Compute season cohorts ONLY from independently verified opponents. */
export function buildDefensiveCohorts(profiles){
  const groups=new Map();
  for(const p of profiles||[]){
    if(!p?.verified||!p.sport||!p.stat||!p.position||
       !Number.isInteger(Number(p.season))||
       !nonnegative(p.metrics?.allowed)||!nonnegative(p.metrics?.volume)||
       !Number.isInteger(p.pregameGames)||p.pregameGames<3)continue;
    const key=[p.sport,p.season,p.position,p.stat,p.league||""].join("|");
    if(!groups.has(key))groups.set(key,new Map());
    const teamKey=String(p.teamId);
    // Avoid treating multiple games from one defense as multiple league teams:
    // the latest verified pregame profile stands for that defense in the cohort.
    if(!groups.get(key).has(teamKey)||Date.parse(p.asOf)>Date.parse(groups.get(key).get(teamKey).asOf))
      groups.get(key).set(teamKey,p);
  }
  const distributions={};
  for(const [key,teams] of groups){
    const rows=[...teams.values()];
    if(rows.length<5)continue;
    const stats={};
    for(const field of ["allowed","volume"]){
      const values=rows.map(x=>x.metrics[field]).filter(nonnegative);
      const mean=values.reduce((a,b)=>a+b,0)/values.length;
      const variance=values.reduce((s,v)=>s+(v-mean)**2,0)/values.length;
      if(variance<=0)continue;
      stats[field]={mean,sd:Math.sqrt(variance)};
    }
    if(!stats.allowed||!stats.volume)continue;
    distributions[key]={teamCount:rows.length,stats,
      method:"sampled same-season opponent cohort (not a full-league rank)"};
  }
  return distributions;
}
function compareMatch(target,historical,cohorts,sport,role,stat,league){
  if(!target?.verified||!historical?.verified||
     target.sport!==sport||historical.sport!==sport||
     target.position!==role||historical.position!==role||
     target.stat!==stat||historical.stat!==stat||
     target.pregameGames<3||historical.pregameGames<3)
    return {ok:false,reason:"Missing verified position/stat pregame defense evidence."};
  if(sport==="soccer" && (!league||target.league!==league||historical.league!==league))
    return {ok:false,reason:"Soccer competition could not be verified consistently."};
  if(sport==="mlb"&&role==="BATTER" &&
     (!["L","R"].includes(target.pitcherHand)||target.pitcherHand!==historical.pitcherHand))
    return {ok:false,reason:"Verified opposing starting pitcher handedness is missing or different."};
  let sum=0;
  const comparisons=[];
  for(const [p,season] of [[target,target.season],[historical,historical.season]]){
    const key=[sport,season,role,stat,league||""].join("|");
    const dist=cohorts[key];
    if(!dist)return {ok:false,reason:"Season-normalized defensive comparison unavailable for "+season+"."};
    const vector=["allowed","volume"].map(field=>{
      const n=p.metrics?.[field],ref=dist.stats[field];
      return nonnegative(n)&&ref?.sd>0?(n-ref.mean)/ref.sd:null;
    });
    if(vector.some(x=>x===null))return {ok:false,reason:"Required defensive features unavailable."};
    comparisons.push({vector,distribution:dist});
  }
  const distance=Math.sqrt(comparisons[0].vector.reduce((acc,n,i)=>
    acc+(n-comparisons[1].vector[i])**2,0)/2);
  if(distance>0.8)
    return {ok:false,reason:"Normalized position/stat defensive profiles are not similar."};
  return {ok:true,score:Math.round((1-Math.min(1,distance/0.8))*1000)/10,
    distance:Math.round(distance*100)/100,
    context:"Same "+role+" / "+stat+"; allowed & usage volume normalized within "+
      target.season+" and "+historical.season+" observed defense cohorts (n="+
      comparisons[0].distribution.teamCount+" / "+
      comparisons[1].distribution.teamCount+"), distance "+distance.toFixed(2)+
      " ≤ 0.80. These are sampled cohorts, not full-league rankings."};
}
function recentWindow(games,season,cutoff){
  return games.filter(g=>Number(g.season)===Number(season)&&
    Date.parse(g.date)<Date.parse(cutoff)).slice(0,5);
}
export function analyzeVerifiedProp({offer,season,games,upcomingDefense,
  defensiveProfiles,matchupModel=null,now=new Date().toISOString()}={}){
  if(!offer||offer.source!=="PropLine"||offer.status!=="active"||
     !supportsMarket(offer.sport,offer.position,offer.stat)||
     !nonnegative(offer.line)||!validDate(offer.quotedAt)||
     !validDate(offer.gameDateLocal)||!offer.id||!offer.bookKey||
     !validDate(now))return null;
  const years=seasonWindow(season),role=positionGroup(offer.sport,offer.position);
  const available=uniqueGames(games).filter(g=>years.includes(Number(g.season))&&
    Date.parse(g.date)<Date.parse(offer.gameDateLocal+"T23:59:59Z")&&
    String(g.playerId)===String(offer.espnPlayerId||g.playerId) &&
    g.stat===offer.stat && g.sport===offer.sport);
  const recent=recentWindow(available,season,offer.gameDateLocal+"T23:59:59Z");
  const profiles=(defensiveProfiles||[]).filter(p=>p?.verified===true);
  const useFootballRank=offer.sport==="nfl"&&matchupModel==="nfl-ranks";
  const cohorts=useFootballRank?{}:buildDefensiveCohorts(profiles);
  const lookup=new Map(profiles.map(p=>[String(p.gameId)+"|"+String(p.teamId),p]));
  const comparable=[];
  const reasons=new Set();
  for(const g of available){
    const historic=lookup.get(String(g.id)+"|"+String(g.opponentId));
    const test=useFootballRank
      ?compareFootballDefenseRanks(upcomingDefense,historic,offer.stat)
      :compareMatch(upcomingDefense,historic,cohorts,
        offer.sport,role,offer.stat,offer.league||null);
    if(test.ok)comparable.push({...evidenceRow(g),
      result:resultAtLine(g.actual,offer.line),similarity:test.score,
      defenseReason:test.context,defenseMetrics:
        useFootballRank?historic[test.rankLane]:historic.metrics,
      ...(useFootballRank?{rankLane:test.rankLane,targetRank:test.targetRank,
        historicalRank:test.historicalRank,rankDifference:test.rankDifference}:{})});
    else reasons.add(test.reason);
  }
  const last5=recent.map(g=>({...evidenceRow(g),result:resultAtLine(g.actual,offer.line)}));
  const recentRate=hitSummary(last5,offer.line);
  const matchedRate=hitSummary(comparable,offer.line);
  const enough=recentRate.tracked>=3 && matchedRate.tracked>=3;
  const favorable=enough && recentRate.hits/recentRate.tracked>0.5 &&
    matchedRate.hits/matchedRate.tracked>0.5;
  return {id:offer.id,player:offer.player,team:offer.team,
    opponent:offer.opponent,position:offer.position,sport:offer.sport,
    source:"PropLine",book:offer.book,bookKey:offer.bookKey,
    variant:offer.variant,price:offer.price,line:offer.line,
    market:offer.market,stat:offer.stat,quotedAt:offer.quotedAt,
    date:offer.gameDateLocal,offer,seasonWindow:years,
    recentGames:last5,recent:recentRate,similarGames:comparable,
    similar:matchedRate,threeSeasonSample:matchedRate.tracked,
    defenseMatchMethod:useFootballRank?"NFL rushing/passing defense rank (±3)":
      "Season-normalized, position-specific defensive cohorts",
    upcomingDefenseRank:useFootballRank?upcomingDefense?.[
      ["rushingYards","rushAttempts","rushingTDs"].includes(offer.stat)
        ?"rushing":"passing"]?.rank:null,
    evidenceSufficient:enough,recommendation:favorable?"OVER":null,
    confidenceLabel:favorable?"Supporting historical evidence":"Insufficient or mixed historical evidence",
    limitations:[...(recentRate.tracked<5?["Fewer than five verified current-season games."]:[]),
      ...(matchedRate.tracked<3?["Insufficient independently verified position-specific comparable defenses."]:[]),
      ...[...reasons].slice(0,3)],
    why:favorable?"Both observed samples exceeded the exact current PropLine line in most recorded games. This is historical evidence, not a forecast.":
      "Do not infer an OVER from incomplete or unfavorable historical evidence."};
}
export function rankEvidence(cards){
  return (cards||[]).sort((a,b)=>{
    const hit=x=>(x.recent.percent??0)/100*0.4+(x.similar.percent??0)/100*0.6;
    const qa=x=>x.evidenceSufficient?1:0;
    return qa(b)-qa(a)||hit(b)-hit(a)||
      b.threeSeasonSample-a.threeSeasonSample||
      String(a.player).localeCompare(String(b.player));
  });
}
