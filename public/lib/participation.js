/**
 * Verified participation gate. Unknown minutes/snaps are not treated as 100%.
 * A recorded start alone does not prove a football player played >50% of snaps.
 */
const finite=x=>typeof x==="number"&&Number.isFinite(x);
const fraction=x=>finite(x)&&x>=0&&x<=1?x:null;
const metricBySport={
  nfl:"offensive snap share",ncaaf:"offensive snap share",
  nba:"minutes / 48 regulation minutes",ncaab:"minutes / 40 regulation minutes",
  soccer:"minutes / 90 regulation minutes",mlb:"verified starting-lineup participation"
};
export function participationInGame(athlete,sport){
  const p=athlete?.playingTime||{};
  if(sport==="nfl"||sport==="ncaaf")
    return fraction(p.snapShare);
  if(sport==="nba"||sport==="ncaab"){
    const regulation=sport==="nba"?48:40;
    return finite(p.minutes)&&p.minutes>=0?Math.min(1,p.minutes/regulation):null;
  }
  if(sport==="soccer")
    return finite(p.minutes)&&p.minutes>=0?Math.min(1,p.minutes/90):null;
  if(sport==="mlb"){
    // MLB hitters do not have 'snaps'. Confirmed batting-lineup starters
    // are eligible; for pitchers require more than half of 27 regulation outs.
    if(p.role==="pitching")
      return finite(p.pitchingOuts)?Math.min(1,p.pitchingOuts/27):null;
    if(p.role==="batting")return p.starter===true?1:p.starter===false?0:null;
  }
  return null;
}
export function playingTimeEligibility(appearances,sport,{minimumGames=3}={}){
  const metric=metricBySport[sport]||"verified playing-time share";
  const examined=(Array.isArray(appearances)?appearances:[]).slice(0,5);
  const data=examined.map(a=>participationInGame(a,sport));
  const verified=data.filter(finite);
  const total=verified.length;
  const averageShare=total?verified.reduce((a,b)=>a+b,0)/total:null;
  const overHalf=verified.filter(v=>v>=0.5).length;
  // Can't establish an expected regular role from old seasons or a roster
  // designation. Require 3 recent known appearances including the latest.
  const eligible=total>=minimumGames && finite(data[0]) &&
    data[0]>=0.5 && averageShare>=0.5 && overHalf>=minimumGames &&
    overHalf>total/2;
  return {eligible,metric,averageShare,samples:total,
    appearances:examined.length,overHalf,reason:!total?"No verified participation data":
      eligible?"Verified regular playing time at least 50%":
      "At least 50% playing-time eligibility not verified"};
}
