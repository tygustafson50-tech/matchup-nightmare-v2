/**
 * Evidence-only NFL strict defense matching. Exact opponent position stats are
 * extracted from ESPN's completed box scores, NOT play-route/target depth data.
 * RB receptions allowed can proxy checkdown friendliness; it is NOT the count
 * of actual QB checkdown passes (which ESPN public box scores don't publish).
 */
import {positionGroup} from "./research-v3.js";
import {playersFromBoxscore,completedTeamGames} from "./evidence-client-v3.js";

const valid=n=>typeof n==="number"&&Number.isFinite(n)&&n>=0;
const bounded=(a,b,floor=1)=>valid(a)&&valid(b)
  ?Math.abs(a-b)/Math.max(floor,a,b):null;
const average=arr=>arr.reduce((x,y)=>x+y,0)/arr.length;
export const NFL_SIMILAR_MIN=4;
export const NFL_SIMILAR_MAX=6;
export const NFL_PRIMARY_RANK_BAND=3;
export const NFL_SECONDARY_RANK_BAND=8;
export const NFL_COVERAGE_GAMES=4;
export const NFL_MAX_CANDIDATES=16;

const ROLE_STAT={
  QB:{passingYards:"passingYards",passAttempts:"passAttempts",
    passCompletions:"passCompletions",passingTDs:"passingTDs",
    rushingYards:"rushingYards",rushAttempts:"rushAttempts",rushingTDs:"rushingTDs"},
  RB:{receptions:"receptions",receivingYards:"receivingYards",targets:"targets",
    receivingTDs:"receivingTDs",rushingYards:"rushingYards",
    rushAttempts:"rushAttempts",rushingTDs:"rushingTDs"},
  WR:{receptions:"receptions",receivingYards:"receivingYards",targets:"targets",
    receivingTDs:"receivingTDs",rushingYards:"rushingYards",
    rushAttempts:"rushAttempts",rushingTDs:"rushingTDs"},
  TE:{receptions:"receptions",receivingYards:"receivingYards",targets:"targets",
    receivingTDs:"receivingTDs"}
};
const laneOf=stat=>["rushingYards","rushAttempts","rushingTDs"].includes(stat)
  ?"rushing":"passing";
function roleTotals(summary,defenseId,role,stat){
  const teams=summary?.boxscore?.players;
  if(!Array.isArray(teams)||teams.length!==2)return null;
  const opponent=teams.find(x=>String(x.team?.id)!==String(defenseId));
  if(!opponent?.team?.id||!teams.some(x=>String(x.team?.id)===String(defenseId)))
    return null;
  const players=playersFromBoxscore(summary,"nfl",opponent.team.id);
  const entries=players.filter(x=>positionGroup("nfl",x.position)===role);
  if(!entries.length)return null; // RB with no row must not become invented 0.
  if(!entries.every(x=>valid(x.stats?.[stat])))return null;
  return entries.reduce((sum,p)=>sum+p.stats[stat],0);
}
export function readDefenseGameContext(summary,defenseId,role,stat){
  const value=roleTotals(summary,defenseId,role,stat);
  const rbCatches=roleTotals(summary,defenseId,"RB","receptions");
  const rbTargets=roleTotals(summary,defenseId,"RB","targets");
  return {value,rbCatches,rbTargets};
}
/**
 * Cache provider JSON outside this function; callers pass their memoized
 * schedule/summary methods. Every metric measures completed PRIOR games.
 */
export async function buildDefenseContext({
  teamId,season,cutoff,role,stat,schedule,summary,maxGames=NFL_COVERAGE_GAMES
}){
  const sample=completedTeamGames(await schedule(teamId,season),teamId,
    cutoff,season).slice(0,maxGames);
  const responses=await Promise.allSettled(sample.map(g=>summary(g.id)));
  const context=[];
  for(const result of responses){
    if(result.status!=="fulfilled")continue;
    context.push(readDefenseGameContext(result.value,teamId,role,stat));
  }
  const values=context.map(x=>x.value).filter(valid);
  const rbCatches=context.map(x=>x.rbCatches).filter(valid);
  const rbTargets=context.map(x=>x.rbTargets).filter(valid);
  return {role,stat,asOf:cutoff,teamId:String(teamId),
    season,verifiedGames:values.length,
    roleAllowed:values.length?Math.round(average(values)*100)/100:null,
    rbCatchesGames:rbCatches.length,
    rbReceptionsAllowed:rbCatches.length?Math.round(average(rbCatches)*100)/100:null,
    rbTargetsGames:rbTargets.length,
    rbTargetsAllowed:rbTargets.length?Math.round(average(rbTargets)*100)/100:null,
    scope:"ESPN completed team box scores BEFORE the matchup",
    checkdownDefinition:"RB receptions allowed per game — proxy, not identified checkdown passes"};
}
export function strictDefenseGate(target,historical,stat){
  const primary=laneOf(stat),secondary=primary==="rushing"?"passing":"rushing";
  const a=target?.[primary],b=historical?.[primary],
    c=target?.[secondary],d=historical?.[secondary];
  if(![a,b,c,d].every(x=>Number.isInteger(x?.rank)&&
    x.rank>=1&&x.rank<=32&&valid(x.yardsPerGame)))
    return {ok:false,reason:"Published ESPN rushing and passing ranks unavailable."};
  const primaryGap=Math.abs(a.rank-b.rank),
    secondaryGap=Math.abs(c.rank-d.rank);
  if(primaryGap>NFL_PRIMARY_RANK_BAND)
    return {ok:false,reason:"Primary defensive rank differs by more than 3."};
  if(secondaryGap>NFL_SECONDARY_RANK_BAND)
    return {ok:false,reason:"Other defensive rank differs by more than 8."};
  const primaryYards=bounded(a.yardsPerGame,b.yardsPerGame),
    secondaryYards=bounded(c.yardsPerGame,d.yardsPerGame);
  if(primaryYards===null||secondaryYards===null||
    primaryYards>0.25||secondaryYards>0.4)
    return {ok:false,reason:"Pass/rush yards allowed per game are not comparable."};
  return {ok:true,primary,secondary,primaryGap,secondaryGap,
    primaryYards,secondaryYards,primaryRank:a.rank,
    historicalRank:b.rank,otherRank:c.rank,historicalOtherRank:d.rank};
}
export function strictDefenseComparison({
  target,historical,stat,role,targetContext,historicalContext
}){
  const gate=strictDefenseGate(target,historical,stat);
  if(!gate.ok)return gate;
  if(!ROLE_STAT[role]?.[stat])return {
    ok:false,reason:"Position-specific ESPN stat unavailable for this role."
  };
  if(!targetContext||!historicalContext||
    targetContext.verifiedGames<3||historicalContext.verifiedGames<3)
    return {ok:false,reason:"Fewer than 3 pregame boxscores with the required position/stat totals."};
  const roleGap=bounded(targetContext.roleAllowed,historicalContext.roleAllowed);
  if(roleGap===null||roleGap>0.35)
    return {ok:false,reason:"Allowed "+role+" "+stat+" rate differs by over 35%."};
  // For RB receiving markets, receptions against RBs measures how often
  // opponents complete passes to backs. It does not identify true checkdowns.
  const receiving=["receptions","receivingYards","targets","receivingTDs"]
    .includes(stat);
  let checkdownGap=null;
  if(receiving && role==="RB"){
    if(targetContext.rbCatchesGames<3||historicalContext.rbCatchesGames<3)
      return {ok:false,reason:"Not enough verified RB receiving data for checkdown proxy."};
    checkdownGap=bounded(targetContext.rbReceptionsAllowed,
      historicalContext.rbReceptionsAllowed);
    if(checkdownGap===null||checkdownGap>0.35)
      return {ok:false,reason:"RB receptions-allowed (checkdown proxy) not comparable."};
  }else if(targetContext.rbCatchesGames>=3&&
    historicalContext.rbCatchesGames>=3){
    checkdownGap=bounded(targetContext.rbReceptionsAllowed,
      historicalContext.rbReceptionsAllowed);
  }
  const score=Math.round(
    100-25*gate.primaryGap/3-10*gate.secondaryGap/8-
    20*gate.primaryYards/0.25-10*gate.secondaryYards/0.4-
    35*roleGap/0.35);
  const context="Strict ESPN NFL "+gate.primary+" #"+gate.historicalRank+
    " vs upcoming #"+gate.primaryRank+
    "; "+gate.secondary+" #"+gate.historicalOtherRank+
    " vs #"+gate.otherRank+"; "+role+" "+stat+" allowed "+
    historicalContext.roleAllowed+"/game vs "+targetContext.roleAllowed+
    "/game (3+ prior boxscores). "+
    (checkdownGap!==null?
      "RB receptions allowed "+historicalContext.rbReceptionsAllowed+
      " vs "+targetContext.rbReceptionsAllowed+
      "/game — CHECKDOWN PROXY only, not route/tracked checkdowns. ":"")+
    "Primary rank ±3, other rank ±8, allowed-yardage and role filters. "+
    "Season league ranks may include later games.";
  return {ok:true,score:Math.max(0,Math.min(100,score)),
    context,rankLane:gate.primary,targetRank:gate.primaryRank,
    historicalRank:gate.historicalRank,
    rankDifference:gate.primaryGap,
    roleAllowed:historicalContext.roleAllowed,
    targetRoleAllowed:targetContext.roleAllowed,
    rbReceptionsAllowed:historicalContext.rbReceptionsAllowed,
    targetRbReceptionsAllowed:targetContext.rbReceptionsAllowed,
    checkdownProxyVerified:checkdownGap!==null,
    contextGames:historicalContext.verifiedGames};
}
export function chooseStrictSimilarGames(rows,max=NFL_SIMILAR_MAX){
  // Deterministic defense-only ranking; NEVER select based on OVER success.
  return [...rows].sort((a,b)=>(b.similarity??0)-(a.similarity??0)||
    (a.rankDifference??99)-(b.rankDifference??99)||
    Date.parse(b.date)-Date.parse(a.date)||String(a.id).localeCompare(String(b.id))
  ).slice(0,max);
}
