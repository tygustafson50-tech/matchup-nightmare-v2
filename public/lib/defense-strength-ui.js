/**
 * Small, accessible defense-rank display shared between upcoming opponent
 * and actual recorded game rows. Rank-based bands are descriptive only.
 */
const escape=v=>String(v??"").replace(/[&<>"']/g,c=>({
  "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
}[c]));
const number=n=>typeof n==="number"&&Number.isFinite(n);
const fmt=n=>number(n)?String(n):"not verified";
export function renderDefenseBadge(snapshot,{upcoming=false}={}){
  if(!snapshot)return '<span class="defense-strength unavailable" '+
    'title="ESPN has not verified a defense rank or comparable allowed-stat sample for this game">'+
    'Defense not verified</span>';
  if(snapshot.kind==="nfl-rank"){
    const type=snapshot.lane==="rushing"?"RUSH D":"PASS D";
    const scope=upcoming?"Current season-to-date ESPN rank":
      "ESPN season aggregate rank; may include games after this historical matchup";
    return '<span class="defense-strength nfl-defense" title="'+escape(scope)+
      ' · 1 = fewest allowed yards of 32 NFL teams">'+
      '<strong>'+type+' #'+escape(snapshot.rank)+'/32</strong>'+
      '<span>'+escape(snapshot.rankTier||"Rank verified")+
      ' · '+escape(fmt(snapshot.yardsPerGame))+' yds/g allowed</span>'+
      '</span>';
  }
  if(snapshot.kind==="position-allowed"){
    return '<span class="defense-strength allowed-defense" title="'+
      'Verified completed opponent box scores before this matchup, not an official league rank">'+
      '<strong>'+escape(snapshot.position)+' '+escape(snapshot.stat)+
      ' allowed: '+escape(fmt(snapshot.allowedPerGame))+'/game</strong>'+
      '<span>'+escape(snapshot.verifiedGames)+' prior ESPN games · no league rank</span>'+
      '</span>';
  }
  return '<span class="defense-strength unavailable">Defense not verified</span>';
}
export function renderUpcomingDefense(snapshot,{opponent="",sport=""}={}){
  const badge=renderDefenseBadge(snapshot,{upcoming:true});
  const isNFL=sport==="nfl"&&snapshot?.kind==="nfl-rank";
  const extra=isNFL?
    '<div class="defense-current-secondary">'+
      (snapshot.passing?'<span>PASS #'+escape(snapshot.passing.rank)+
        '/32 · '+escape(snapshot.passing.yardsPerGame)+' yds/g</span>':"")+
      (snapshot.rushing?'<span>RUSH #'+escape(snapshot.rushing.rank)+
        '/32 · '+escape(snapshot.rushing.yardsPerGame)+' yds/g</span>':"")+
    '</div>':"";
  const scope=isNFL?"ESPN season-to-date team rankings (1 = strongest by yards allowed)."+
    " Historical game ranks are season aggregates, not verified pregame ranks.":
    snapshot?.kind==="position-allowed"?
    "Verified position/stat allowance over completed prior games; not a league rank or predictive grade.":
    "No independently verified defensive rank or sufficient position/stat sample available.";
  return '<section class="upcoming-defense-strength" aria-label="Upcoming opponent defense strength">'+
    '<div class="upcoming-defense-heading"><strong>CURRENT MATCHUP · '+
      escape(opponent||"Upcoming opponent")+'</strong></div>'+
    '<div class="upcoming-defense-body">'+badge+extra+'</div>'+
    '<p class="upcoming-defense-source">'+escape(scope)+'</p>'+
  '</section>';
}
