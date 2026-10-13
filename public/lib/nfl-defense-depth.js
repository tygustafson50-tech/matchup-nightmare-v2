/**
 * Evidence-only NFL strict defense matching. Exact opponent position stats are
 * extracted from ESPN's completed box scores, NOT play-route/target depth data.
 * RB receptions allowed can proxy checkdown friendliness; it is NOT the count
 * of actual QB checkdown passes (which ESPN public box scores don't publish).
 */
import {positionGroup} from "./research-v3.js";
import {playersFromBoxscore,completedTeamGames} from "./evidence-client-v3.js";
import {selectDistinctDefenseGames} from "./defense-selection.js";

const valid=n=>typeof n==="number"&&Number.isFinite(n)&&n>=0;
const bounded=(a,b,floor=1)=>valid(a)&&valid(b)
  ?Math.abs(a-b)/Math.max(floor,a,b):null;
const average=arr=>arr.reduce((x,y)=>x+y,0)/arr.length;
export const NFL_SIMILAR_MIN=3;
export const NFL_SIMILAR_MAX=6;
export const NFL_PRIMARY_RANK_BAND=5;
export const NFL_PRIMARY_YARDS_TOLERANCE=0.10;
export const NFL_SECONDARY_RANK_BAND=16;
export const NFL_COVERAGE_GAMES=4;
export const NFL_MAX_CANDIDATES=24;

// All QB/RB/WR/TE prop positions and ALL supported football stat markets
// are eligible. Real ESPN stat totals and three+ prior recorded samples are
// still mandatory; rare cross-position plays are never fabricated.
const ROLE_STAT=Object.fromEntries(["QB","RB","WR","TE"].map(role=>[
  role,Object.fromEntries([
    "passingYards","passAttempts","passCompletions","passingTDs",
    "rushingYards","rushAttempts","rushingTDs",
    "receptions","receivingYards","targets","receivingTDs"
  ].map(stat=>[stat,stat]))
]));
const laneOf=stat=>["rushingYards","rushAttempts","rushingTDs"].includes(stat)
  ?"rushing":"passing";
function roleTotals(summary,defenseId,role,stat,positionsById=null){
  const teams=summary?.boxscore?.players;
  if(!Array.isArray(teams)||teams.length!==2)return null;
  const opponent=teams.find(x=>String(x.team?.id)!==String(defenseId));
  if(!opponent?.team?.id||!teams.some(x=>String(x.team?.id)===String(defenseId)))
    return null;
  const players=playersFromBoxscore(summary,"nfl",opponent.team.id,positionsById);
  const entries=players.filter(x=>positionGroup("nfl",x.position)===role);
  if(!entries.length)return null; // RB with no row must not become invented 0.
  if(!entries.every(x=>valid(x.stats?.[stat])))return null;
  return entries.reduce((sum,p)=>sum+p.stats[stat],0);
}
export function readDefenseGameContext(
  summary,defenseId,role,stat,positionsById=null
){
  const value=roleTotals(summary,defenseId,role,stat,positionsById);
  const rbCatches=roleTotals(summary,defenseId,"RB","receptions",positionsById);
  const rbTargets=roleTotals(summary,defenseId,"RB","targets",positionsById);
  return {value,rbCatches,rbTargets};
}
/**
 * Cache provider JSON outside this function; callers pass their memoized
 * schedule/summary methods. Every metric measures completed PRIOR games.
 */
export async function buildDefenseContext({
  teamId,season,cutoff,role,stat,schedule,summary,
  resolvePositions=null,maxGames=NFL_COVERAGE_GAMES
}){
  const sample=completedTeamGames(await schedule(teamId,season),teamId,
    cutoff,season).slice(0,maxGames);
  const responses=await Promise.allSettled(sample.map(async g=>{
    const box=await summary(g.id);
    const positionsById=resolvePositions
      ?await resolvePositions(box,teamId,season)
      :null;
    return readDefenseGameContext(box,teamId,role,stat,positionsById);
  }));
  const context=[];
  for(const result of responses){
    if(result.status!=="fulfilled")continue;
    context.push(result.value);
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
  const primaryYards=bounded(a.yardsPerGame,b.yardsPerGame);
  const secondaryYards=bounded(c.yardsPerGame,d.yardsPerGame);
  if(primaryYards===null||secondaryYards===null)
    return {ok:false,reason:"Real pass/rush allowed yardage is missing."};
  // The upcoming opponent is similar when the PRIMARY defense is within
  // five actual ESPN league ranks OR allowed yardage within ten percent.
  const rankMatch=primaryGap<=NFL_PRIMARY_RANK_BAND;
  const rateMatch=primaryYards<=NFL_PRIMARY_YARDS_TOLERANCE;
  if(!rankMatch&&!rateMatch)
    return {ok:false,reason:"Primary defense differs by over 5 ranks AND over 10% in yards allowed."};
  // Passing and rushing cannot be wildly opposite even if primary fits;
  // the companion dimension is no longer an overly narrow ±8 requirement.
  if(secondaryGap>NFL_SECONDARY_RANK_BAND&&secondaryYards>0.35)
    return {ok:false,reason:"Secondary rushing/passing defense is radically different."};
  if(secondaryYards>0.5)
    return {ok:false,reason:"Secondary pass/rush yards allowed differs by over 50%."};
  return {ok:true,primary,secondary,primaryGap,secondaryGap,
    primaryYards,secondaryYards,rankMatch,rateMatch,
    matchBasis:rankMatch?"within 5 defensive ranks":"within 10% yards allowed",
    primaryRank:a.rank,
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
  // Historical ESPN team rosters sometimes contain *zero* athlete
  // positions (confirmed against 2025 game schedules). A missing position
  // history cannot invalidate an independently verified ESPN rank/rate
  // comparison. Label these as RANK-ONLY, never as verified WR/RB coverage.
  if(!targetContext||!historicalContext||
    targetContext.verifiedGames<3||historicalContext.verifiedGames<3){
    const score=Math.max(0,Math.round(46-
      14*Math.min(1,gate.primaryGap/NFL_PRIMARY_RANK_BAND)-
      10*Math.min(1,gate.primaryYards/NFL_PRIMARY_YARDS_TOLERANCE)-
      7*Math.min(1,gate.secondaryYards/0.5)));
    return {ok:true,score,
      matchBasis:gate.matchBasis+" (rank/rate only — position sample missing)",
      matchTier:gate.rankMatch?3:4,
      rankLane:gate.primary,targetRank:gate.primaryRank,
      historicalRank:gate.historicalRank,rankDifference:gate.primaryGap,
      contextGames:historicalContext?.verifiedGames||0,
      roleAllowed:null,targetRoleAllowed:null,
      rbReceptionsAllowed:null,targetRbReceptionsAllowed:null,
      checkdownProxyVerified:false,positionCoverageVerified:false,
      context:"ESPN "+gate.primary+" defense #"+gate.historicalRank+
        " vs upcoming #"+gate.primaryRank+
        "; ESPN allowed yards "+historical[gate.primary].yardsPerGame+
        " vs "+target[gate.primary].yardsPerGame+"/game; "+
        "matched "+gate.matchBasis+". Verified league ranks and yards only."+
        " Historical player stat is real ESPN boxscore evidence; position coverage"+
        " and checkdown rates NOT VERIFIED for this comparison."+
        " Historical full-season rank may include later games."};
  }
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
  const score=Math.round(100-
    27*Math.min(1,gate.primaryGap/NFL_PRIMARY_RANK_BAND)-
    12*Math.min(1,gate.secondaryGap/NFL_SECONDARY_RANK_BAND)-
    14*Math.min(1,gate.primaryYards/NFL_PRIMARY_YARDS_TOLERANCE)-
    10*Math.min(1,gate.secondaryYards/0.5)-
    37*Math.min(1,roleGap/0.35));
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
    "Primary matched "+gate.matchBasis+
    "; verified complementary pass/rush rates and position coverage. "+
    "Season league ranks may include later games.";
  return {ok:true,score:Math.max(0,Math.min(100,score)),
    context,rankLane:gate.primary,targetRank:gate.primaryRank,
    historicalRank:gate.historicalRank,
    rankDifference:gate.primaryGap,matchBasis:gate.matchBasis,
    matchTier:gate.rankMatch?1:2,
    roleAllowed:historicalContext.roleAllowed,
    targetRoleAllowed:targetContext.roleAllowed,
    rbReceptionsAllowed:historicalContext.rbReceptionsAllowed,
    targetRbReceptionsAllowed:targetContext.rbReceptionsAllowed,
    checkdownProxyVerified:checkdownGap!==null,
    positionCoverageVerified:true,
    contextGames:historicalContext.verifiedGames};
}
export function chooseStrictSimilarGames(rows,max=NFL_SIMILAR_MAX){
  // One game per genuinely distinct historical defense, highest actual fit.
  return selectDistinctDefenseGames(rows,max);
}
