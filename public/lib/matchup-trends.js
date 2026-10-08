/**
 * Matchup Nightmare — matchup trend model V3
 *
 * Recent five = selected season, no exception.
 * Similar four = most recent truly comparable defenses within three seasons.
 * The OVER threshold is selected independently of comparable-defense results.
 * A 4/4 is an observed historical fraction, NOT a betting probability.
 *
 * No fabricated projections or unseen opponent/pitcher rankings.
 */
import {CONFIG,matchupRole} from "./auto-scan.js";

export const COMPARABLE_TOLERANCE=0.25;
export const DEFENSE_MIN_GAMES=2;
const finite=n=>typeof n==="number"&&Number.isFinite(n);
const seasonOK=(n,expected)=>n!==undefined&&n!==null&&Number(n)===expected;
const delta=(before,after)=>Math.round((before-after)*1000)/10;
const uniqueSorted=items=>[...new Set(items)].sort((a,b)=>b-a);
const asLine=v=>finite(v)&&v>=0.5?Math.round(v*2)/2:null;

/**
 * Until licensed odds/prop-line data are connected, choose a research-only
 * alt line from CURRENT-season form, never from the historical defenses being
 * tested. Stats in our supported prop markets are discrete counts/yards.
 */
export function chooseIndependentLine(recent,minimum,quoted=null){
  if(quoted && quoted.verified===true &&
      ["PrizePicks","sportsbook","sportsbook-alt"].includes(quoted.source) &&
      finite(quoted.line)&&quoted.line>=0.5 &&
      typeof quoted.quotedAt==="string" && Number.isFinite(Date.parse(quoted.quotedAt))){
    return {
      line:quoted.line,kind:quoted.source,marketSource:
        quoted.source+" — verified line captured "+quoted.quotedAt,
      quoteTime:quoted.quotedAt,verified:true
    };
  }
  const nums=(Array.isArray(recent)?recent:[])
    .map(r=>r.value).filter(v=>finite(v)&&v>=0).sort((a,b)=>a-b);
  if(!nums.length)return null;
  const n=nums.length,median=n%2?nums[(n-1)/2]:(nums[n/2-1]+nums[n/2])/2;
  const derived=Math.max(0.5,Math.max((minimum??1)-0.5,Math.floor(median)-0.5));
  return {
    line:asLine(derived),kind:"research-only",
    marketSource:"Research-only OVER threshold: current-season median; not a live PrizePicks or sportsbook line",
    quoteTime:null,verified:false
  };
}
/**
 * Compare defenses on the same market and *exact* position role.
 * The primary metric is observed pregame stat conceded per game. Optional
 * verified features may narrow results, never fabricate rankings or data.
 */
export function compareDefenses({sport,stat,role,target,historical,
  historicalLeague=null,currentLeague=null}={}){
  const a=target?.average,b=historical?.average;
  if(!role||!finite(a)||a<=0||!finite(b)||b<0||
      !Number.isInteger(target?.games)||target.games<DEFENSE_MIN_GAMES||
      !Number.isInteger(historical?.games)||historical.games<DEFENSE_MIN_GAMES)
    return {comparable:false,reason:"A current or historical stat/position-specific defensive average was not verified."};
  const pct=Math.abs(b-a)/a;
  if(pct>COMPARABLE_TOLERANCE)
    return {comparable:false,reason:"Defensive concession rates differ by more than 25%.",deltaPct:Math.round(pct*1000)/10};
  // Never compare a verified cross-league soccer opponent as equivalent if
  // competition is known to differ. Unknown league = unverified context.
  if(sport==="soccer"&&historicalLeague&&currentLeague&&historicalLeague!==currentLeague)
    return {comparable:false,reason:"Opponents played in different verified soccer leagues."};
  // Baseball is fundamentally hitter-vs-starting-pitcher, not just team
  // defense. Staff averages may NOT be labeled a comparable pitcher.
  if(sport==="mlb"&&role.role==="BATTERS"){
    const aHand=String(target.pitcherHand||"").toUpperCase();
    const bHand=String(historical.pitcherHand||"").toUpperCase();
    if(!["R","L"].includes(aHand)||!["R","L"].includes(bHand))
      return {comparable:false,reason:"Comparable hitter matchups require verified opposing starter handedness, unavailable from this feed."};
    if(aHand!==bHand)
      return {comparable:false,reason:"Opposing starting pitchers use different verified throwing hands."};
    // An opponent pitching-staff average remains only one supporting metric:
    // mark starter-specific pitch mix unverified if not available.
  }
  // Optional recorded style dimensions: only constrain when BOTH sides have
  // a VERIFIED number. Absence is shown as unverified, never imputed.
  const optional=[
    ["pace",0.25],
    ["defensiveEfficiency",0.25],
    ["lineupStrikeoutRate",0.25],
    ["pitcherStrikeoutRate",0.25]
  ];
  const verifiedExtras=[],unavailableExtras=[];
  for(const [key,tolerance] of optional){
    const ta=target[key],hi=historical[key];
    if(finite(ta)&&finite(hi)&&ta>0){
      const gap=Math.abs(hi-ta)/ta;
      if(gap>tolerance)
        return {comparable:false,reason:key+" differs by more than "+Math.round(tolerance*100)+"%."};
      verifiedExtras.push(key);
    }else if(finite(ta)||finite(hi)){
      unavailableExtras.push(key);
    }
  }
  const label=target.metricLabel||historical.metricLabel||
    role.metricLabel||(role.label+" "+stat+" allowed per game");
  const deltaPct=Math.round(pct*1000)/10;
  return {
    comparable:true,deltaPct,absoluteDifference:Math.round((b-a)*100)/100,
    allowed:Math.round(b*100)/100,upcomingAllowed:Math.round(a*100)/100,
    metricLabel:label,defenseGames:historical.games,
    ranking:Number.isInteger(historical.rank)?historical.rank:null,
    confidence:historical.games>=5&&target.games>=5?"more-records":"small-sample",
    verifiedExtras,unavailableExtras,
    reason:"Allowed "+b.toFixed(1)+" vs upcoming "+a.toFixed(1)+
      " "+label+" (difference "+deltaPct.toFixed(1)+"%, within 25%; "+
      historical.games+" prior defensive games)"
  };
}
function fullDate(value){
  const time=Date.parse(value);
  return Number.isFinite(time)?time:-Infinity;
}
function pickThresholdQuotes(quotes,athleteId,stat){
  return quotes?.[String(athleteId)]?.[stat]??null;
}
function normalizeProfile(raw){
  if(!raw||typeof raw!=="object")return null;
  return raw;
}

export function buildMatchupCards(records,team,game,defenseProfiles,{
  window=3,quotedLines=null,league=null
}={}){
  if(!CONFIG[game?.sport])return [];
  const season=Number(game.season);
  if(!Number.isInteger(season))return [];
  const gameTime=fullDate(game.date);
  if(!finite(gameTime))return [];
  const horizon=Array.from({length:window},(_,i)=>season-i);
  const grouped=new Map();
  for(const record of Array.isArray(records)?records:[]){
    if(!horizon.includes(Number(record?.season))||
       fullDate(record?.date)>=gameTime||!finite(fullDate(record?.date)))continue;
    const roster=Array.isArray(record.players)?record.players:[];
    for(const athlete of roster){
      if(!athlete?.id||!athlete.stats)continue;
      for(const [stat,market,min] of CONFIG[game.sport].markets){
        const value=athlete.stats[stat];
        if(!finite(value)||value<0)continue;
        const key=String(athlete.id)+"|"+stat;
        const entry=grouped.get(key)||{
          playerId:String(athlete.id),player:athlete.name||"Player",position:"",
          headshot:athlete.headshot||null,market,stat,minimum:min,all:[]
        };
        entry.all.push({
          gameId:String(record.id),date:record.date,season:Number(record.season),
          opponent:String(record.opponent||"Opponent"),opponentId:String(record.opponentId||""),
          playedTeamId:String(record.playedTeamId||team.id),
          playedTeamName:record.playedTeamName||team.name,
          positionAtGame:athlete.position||"",league:record.league||null,
          value
        });
        grouped.set(key,entry);
      }
    }
  }
  const cards=[];
  for(const entry of grouped.values()){
    const seen=new Set();
    const chronological=entry.all.sort((a,b)=>fullDate(b.date)-fullDate(a.date))
      .filter(g=>{
        const id=g.gameId+"|"+g.playedTeamId;
        if(seen.has(id))return false;
        seen.add(id);
        return true;
      });
    const current=chronological.filter(g=>seasonOK(g.season,season));
    if(!current.length)continue; // no current-season player evidence
    const recent=current.slice(0,5); // NEVER borrow a previous season
    const activePosition=current.find(g=>g.positionAtGame)?.positionAtGame||"";
    const role=matchupRole(game.sport,activePosition,entry.stat);
    const threshold=chooseIndependentLine(recent,entry.minimum,
      pickThresholdQuotes(quotedLines,entry.playerId,entry.stat));
    if(!threshold||!finite(threshold.line))continue;
    if(recent.every(g=>g.value<entry.minimum)&&!threshold.verified)continue;
    const line=threshold.line,recentHits=recent.filter(g=>g.value>line).length;
    const targetKey=role?entry.stat+"|"+role.role:null;
    const target=normalizeProfile(targetKey
      ?defenseProfiles?.[team.targetOpponentId]?.target?.[targetKey]:null);
    const eligible=[],notComparable={role:0,profile:0,outside:0};
    for(const g of chronological){
      if(!role||!g.opponentId||!g.gameId){notComparable.role++;continue;}
      const priorRole=matchupRole(game.sport,g.positionAtGame,entry.stat);
      if(priorRole?.role!==role.role){notComparable.role++;continue;}
      const historic=normalizeProfile(defenseProfiles?.[g.opponentId]?.[g.gameId]?.[targetKey]);
      const comparison=compareDefenses({
        sport:game.sport,stat:entry.stat,role,target,historical:historic,
        historicalLeague:g.league,currentLeague:league
      });
      if(!comparison.comparable){notComparable.profile++;continue;}
      eligible.push({
        ...g,opponentAllowed:comparison.allowed,
        opponentDefenseGames:comparison.defenseGames,
        opponentRanking:comparison.ranking,
        upcomingDefenseAllowed:comparison.upcomingAllowed,
        defensiveDifferencePercent:comparison.deltaPct,
        metricLabel:comparison.metricLabel,
        comparableReason:comparison.reason,
        confidence:comparison.confidence,
        optionalMetricsVerified:comparison.verifiedExtras,
        optionalMetricsMissing:comparison.unavailableExtras
      });
    }
    const similar=eligible.slice(0,4);
    const similarHits=similar.filter(g=>g.value>line).length;
    const similarSample=similar.length;
    const recentSample=recent.length;
    const similarPct=similarSample?Math.round(similarHits/similarSample*100):null;
    const recentPct=recentSample?Math.round(recentHits/recentSample*100):null;
    const matchReason=similarSample
      ?similarSample+" verified matches with "+(target?.metricLabel||role.metricLabel)+
        " within 25% of the upcoming opponent; "+similarHits+"/"+similarSample+
        " exceeded the independently selected line."
      :(role
        ?(!target?"No verified pregame defensive baseline for the upcoming opponent.":
          "No verified historical defenses met the exact position/stat comparison and context rules.")
        :"Player position unavailable or unsuitable for this stat; defensive similarity not verified.");
    const isFull=similarSample===4;
    const caution=[];
    if(similarSample<4)caution.push("Only "+similarSample+
      " of four possible comparable games verified; unrelated games were not substituted.");
    if(similar.some(g=>g.confidence==="small-sample"))
      caution.push("One or more defenses use fewer than five pregame records.");
    if(recentSample<3)
      caution.push("Current-season form has fewer than three recorded games; this is a small sample.");
    if(game.sport==="soccer"&&chronological.some(g=>!g.league))
      caution.push("Some soccer game histories lack verified league/tactical context; cross-league comparability is not established.");
    if(game.sport==="mlb"&&role?.role==="BATTERS"&&!similarSample)
      caution.push("Verified starting-pitcher handedness is required for hitter matching; pitching-staff totals alone are insufficient.");
    const sampleWarning=caution.join(" ")||null;
    const output={
      playerId:entry.playerId,player:entry.player,headshot:entry.headshot,
      position:activePosition,teamId:team.id,teamName:team.name,
      opponentId:team.targetOpponentId,market:entry.market,stat:entry.stat,
      line,marketSource:threshold.marketSource,
      lineType:threshold.kind,lineVerified:threshold.verified,
      lineQuotedAt:threshold.quoteTime,sourceMarketLine:threshold.verified,
      recentSeason:season,history:recent,recentHits,recentSample,recentPct,
      similarGames:similar,similarHits,similarSample,similarPct,similarTarget:4,
      matched:similarHits,sample:similarSample,
      scanMode:similarSample?"similar":"recent",
      researchMode:"position-stat-career",
      matchedSeasons:uniqueSorted(similar.map(g=>g.season)),
      careerSampleSeasons:uniqueSorted(chronological.map(g=>g.season)),
      matchupPosition:role?.label||null,matchupMetric:target?.metricLabel||role?.metricLabel||null,
      targetDefense:target?.average??null,targetDefenseGames:target?.games??0,
      targetDefenseRanking:Number.isInteger(target?.rank)?target.rank:null,
      notComparableCounts:notComparable,
      sampleWarning,reason:matchReason,
      verifiedSimilarSample:isFull,gameId:game.id,gameDate:game.date,
      injuryStatus:"unverified",expectedPlayingTime:"unverified",
      tacticalContextVerified:false,
      dataScope:{
        league:league||null,threeSeasonWindow:horizon,
        positionSpecific:!!role,starterPitchMixVerified:false,
        lineupChangesVerified:false
      }
    };
    cards.push(output);
  }
  return cards.sort((a,b)=>{
    const aSim=a.similarSample>0?0:1,bSim=b.similarSample>0?0:1;
    return aSim-bSim||
      b.similarSample-a.similarSample||
      (b.similarPct??-1)-(a.similarPct??-1)||
      b.recentSample-a.recentSample||
      String(a.player).localeCompare(String(b.player));
  });
}
