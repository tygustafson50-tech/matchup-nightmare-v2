/**
 * Strict non-NFL sport / role / stat comparison.
 * Source-only game evidence: no synthetic odds, schedules or stat totals.
 * Every supported stat uses its own recorded role allowance, usage count,
 * plus an independently recorded companion stat when available.
 * Players are matched by defense/position fit BEFORE assessing OVER success.
 */
export const STRICT_MIN_MATCHES=4;
export const STRICT_MAX_MATCHES=6;
const number=n=>typeof n==="number"&&Number.isFinite(n)&&n>=0;
const gap=(a,b)=>number(a)&&number(b)
  ?Math.abs(a-b)/Math.max(1,a,b):null;

export const DEEP_STAT_DIMENSIONS=Object.freeze({
  ncaaf:{
    passingYards:["passCompletions"],passCompletions:["passingYards"],
    passAttempts:["passingYards"],passingTDs:["passingYards"],
    rushingYards:["rushAttempts"],rushAttempts:["rushingYards"],
    rushingTDs:["rushingYards"],receptions:["receivingYards"],
    receivingYards:["receptions"],targets:["receptions"],
    receivingTDs:["receivingYards"]
  },
  nba:{
    points:["assists"],rebounds:["points"],assists:["points"],
    threes:["points"],pra:["points","rebounds"],
    steals:["assists"],blocks:["rebounds"]
  },
  ncaab:{
    points:["assists"],rebounds:["points"],assists:["points"],
    threes:["points"],pra:["points","rebounds"],
    steals:["assists"],blocks:["rebounds"]
  },
  mlb:{
    hits:["walks"],totalBases:["hits"],homeRuns:["hits"],
    runs:["hits"],rbis:["hits"],walks:["hits"],
    pitcherKs:["walks"],pitchingOuts:["battingStrikeouts"]
  },
  soccer:{
    shots:["shotsOnTarget"],shotsOnTarget:["shots"],
    goals:["shots"],assists:["shots"],
    tackles:["fouls"],fouls:["tackles"],saves:["shots"]
  }
});
const pct=(n)=>Math.round(1000*n)/10;
const fmt=n=>Number(n).toFixed(2).replace(/0+$/,"").replace(/\.$/,"");
const RATIO_MAX={allowed:0.30,volume:0.35,support:0.40};
export function deepStatSpec(sport,stat,role){
  const secondary=DEEP_STAT_DIMENSIONS[sport]?.[stat]||null;
  if(!secondary||!role)return null;
  if(sport==="mlb"&&((role==="P")!==["pitcherKs","pitchingOuts"].includes(stat)))
    return null;
  if(sport==="soccer"&&role==="GK"&&stat!=="saves")return null;
  if(sport==="soccer"&&stat==="saves"&&role!=="GK")return null;
  return {sport,stat,role,secondary:[...secondary],
    primaryDescription:sport==="mlb"&&role==="P"
      ?stat==="pitchingOuts"?"Opponent batting at-bats (pitcher-out opportunity proxy)":
        "Opponent batting strikeouts (pitcher-K opportunity)"
      :sport==="soccer"&&role==="GK"
        ?"Opponent shots on target (goalkeeper save opportunity proxy)"
        :"Opponent player-position "+stat+" actually recorded",
    note:sport==="mlb"&&role==="P"&&stat==="pitchingOuts"
      ?"At-bats approximate opportunities; they are NOT pitcher outs."
      :sport==="soccer"&&role==="GK"
        ?"Shots on target approximate save chances; they are NOT goalkeeper saves."
        :"Position-sourced game totals, not league-wide defensive ranks"};
}
export function makeDeepProfile({sport,role,stat,teamId,gameId,
  season,asOf,metrics,verifiedGames,secondaryStats,secondaryGames,league=null}){
  const spec=deepStatSpec(sport,stat,role);
  if(!spec||verifiedGames<3||!number(metrics?.allowed)||!number(metrics?.volume))
    return null;
  const support={};
  for(const key of spec.secondary){
    if(number(secondaryStats?.[key])&&secondaryGames?.[key]>=3)
      support[key]={allowed:secondaryStats[key],games:secondaryGames[key]};
  }
  return {sport,position:role,stat,teamId:String(teamId),gameId,
    season,asOf,verifiedGames,pregameGames:verifiedGames,
    metrics,secondary:support,spec,verified:true,league};
}
/**
 * Strict sources: 3+ past completed games with per-role stat and volume on
 * EACH side, main allowed rate difference <=30%, volume <=35%.
 * Each available valid companion dimension must agree within 40%.
 * Without a companion metric on both sides: insufficient, never substitute.
 */
export function compareDeepDefense(target,historical,{sport,stat,role,league}){
  const spec=deepStatSpec(sport,stat,role);
  if(!spec)return {ok:false,reason:"Sport, position or stat lacks supported defensive evidence."};
  if(!target?.verified||!historical?.verified||
    target.sport!==sport||historical.sport!==sport||
    target.position!==role||historical.position!==role||
    target.stat!==stat||historical.stat!==stat||
    target.verifiedGames<3||historical.verifiedGames<3)
    return {ok:false,reason:"Fewer than three verified prior position/stat games."};
  if(sport==="soccer"&&(!league||target.league!==league||
    historical.league!==league))
    return {ok:false,reason:"Soccer league mismatch; no cross-league inferred rates."};
  const allowedGap=gap(target.metrics?.allowed,historical.metrics?.allowed);
  const volumeGap=gap(target.metrics?.volume,historical.metrics?.volume);
  if(allowedGap===null||volumeGap===null)
    return {ok:false,reason:"Missing recorded position stat or usage metric."};
  if(allowedGap>RATIO_MAX.allowed||volumeGap>RATIO_MAX.volume)
    return {ok:false,reason:"Position allowance or usage differs beyond strict limits."};
  const comparison=[];
  for(const companion of spec.secondary){
    const t=target.secondary?.[companion],h=historical.secondary?.[companion];
    if(!t||!h||t.games<3||h.games<3)
      return {ok:false,reason:"Missing verified "+companion+" comparison in at least three prior games."};
    const ratio=gap(t.allowed,h.allowed);
    if(ratio===null||ratio>RATIO_MAX.support)
      return {ok:false,reason:"Recorded "+companion+" allowance differs beyond strict limits."};
    comparison.push({stat:companion,current:t.allowed,historical:h.allowed,
      relativeDifference:pct(ratio)});
  }
  const meanCompanion=comparison.length
    ?comparison.reduce((sum,x)=>sum+x.relativeDifference/100,0)/comparison.length:0;
  const score=Math.max(0,Math.round(100-
    allowedGap/RATIO_MAX.allowed*45-
    volumeGap/RATIO_MAX.volume*30-
    meanCompanion/RATIO_MAX.support*25));
  return {ok:true,score,roleAllowed:historical.metrics.allowed,
    targetRoleAllowed:target.metrics.allowed,usage:historical.metrics.volume,
    targetUsage:target.metrics.volume,companion:comparison,
    comparisonGames:historical.verifiedGames,
    context:"Strict "+sport.toUpperCase()+" "+role+" "+stat+
      ": recorded position/opponent rate "+fmt(historical.metrics.allowed)+
      "/game vs upcoming "+fmt(target.metrics.allowed)+
      "/game, usage "+fmt(historical.metrics.volume)+
      " vs "+fmt(target.metrics.volume)+
      "; recorded "+comparison.map(c=>c.stat+" "+fmt(c.historical)+
        " vs "+fmt(c.current)).join(", ")+
      ". Each sample has 3+ prior games. "+spec.note
  };
}
export function chooseDeepGames(games,max=STRICT_MAX_MATCHES){
  return [...games].sort((a,b)=>(b.similarity??0)-(a.similarity??0)||
    Date.parse(b.date)-Date.parse(a.date)||
    String(a.id).localeCompare(String(b.id))).slice(0,max);
}
