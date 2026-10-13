/**
 * Defense strength is only presented when backed by a source-verified
 * ESPN season-wide NFL opponent rank, or an ESPN prior-game position/stat
 * allowance. These are NOT independently validated predictive grades.
 * 2024/25 NFL final-season ranks can include games later than the match.
 */
import {footballDefenseLane} from "./football-defense-ranks.js";
import {positionGroup} from "./research-v3.js";

const measured=n=>typeof n==="number"&&Number.isFinite(n)&&n>=0;
const rankOk=n=>Number.isInteger(n)&&n>=1&&n<=32;
const round1=n=>Math.round(n*10)/10;
export function defenseStrength({sport,stat,position,profile}={}){
  if(!profile?.verified)return null;
  if(sport==="nfl"){
    const lane=footballDefenseLane(stat);
    const selected=profile[lane];
    if(!lane||!rankOk(selected?.rank)||
      !measured(selected?.yardsPerGame))return null;
    const passing=profile.passing,rushing=profile.rushing;
    const safeLane=l=>rankOk(l?.rank)&&measured(l?.yardsPerGame)
      ?{rank:l.rank,yardsPerGame:round1(l.yardsPerGame)}:null;
    return {
      kind:"nfl-rank",sport,stat,season:Number(profile.season),
      lane,rank:selected.rank,leagueSize:32,
      yardsPerGame:round1(selected.yardsPerGame),
      passing:safeLane(passing),rushing:safeLane(rushing),
      rankTier:selected.rank<=8?"Top 8":selected.rank<=16?"9–16":
        selected.rank<=24?"17–24":"25–32",
      source:"ESPN opponent team statistics",
      scope:"Season aggregate, not game-day rank; prior-season final ranks may include later games."
    };
  }
  const role=positionGroup(sport,position);
  const p=profile;
  const games=p.verifiedGames??p.pregameGames;
  if(!role||p.sport!==sport||p.stat!==stat||p.position!==role||
    !measured(p.metrics?.allowed)||!Number.isInteger(games)||games<3)
    return null;
  return {
    kind:"position-allowed",sport,stat,position:role,
    season:Number(p.season),allowedPerGame:round1(p.metrics.allowed),
    verifiedGames:games,
    source:"ESPN completed opponent game box scores",
    scope:"Position/stat rate over prior completed games; not an official league rank or grade."
  };
}
