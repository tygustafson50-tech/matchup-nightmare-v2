/**
 * Shared game-by-game presentation for all six sports.
 * Markets and opponent labels come from the scanner response.
 * Never synthesize missing performance statistics.
 */
export const escapeHistoryHtml = value => String(value ?? "").replace(/[&<>"']/g, char => ({
  "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;"
}[char]));

export function readableGameDate(value) {
  const match=String(value??"").match(/^(\d{4})-(\d{2})-(\d{2})/);
  if(!match) return "Date unavailable";
  const [,year,month,day]=match;
  const date=new Date(Date.UTC(Number(year),Number(month)-1,Number(day)));
  if(Number.isNaN(date.getTime()) || date.toISOString().slice(0,10)!==year+"-"+month+"-"+day) return "Date unavailable";
  return date.toLocaleDateString("en-US",{timeZone:"UTC",month:"short",day:"numeric"});
}

export function renderGameHistory(games, line, market, options={}) {
  const list=Array.isArray(games)?games.filter(g=>g&&Number.isFinite(g.value)).slice(0,options.limit??5):[];
  const heading=options.heading??"Recent games";
  const name=escapeHistoryHtml(market||"Recorded stat");
  const countLabel=escapeHistoryHtml(options.countLabel??(list.length+" recorded games"));
  const title='<div class="game-log-title"><strong>'+escapeHistoryHtml(heading)+'</strong><span>'+countLabel+'</span></div>';
  if(!list.length) {
    const message=escapeHistoryHtml(options.emptyMessage??"No verified recorded games available for this market.");
    return '<section class="game-log-section" aria-label="'+escapeHistoryHtml(heading)+'">'+
      title+'<p class="game-log-empty">'+message+'</p></section>';
  }
  const rows=list.map(game=>{
    const result=game.value>line?"OVER":game.value===line?"PUSH":"BELOW";
    const resultClass=result.toLowerCase();
    const opponent=game.opponent?escapeHistoryHtml(game.opponent):"Opponent unavailable";
    const comparableMetric=options.showOpponentDefense&&Number.isFinite(game.opponentAllowed)&&game.opponentDefenseGames>=2
      ?'<small class="game-log-opponent-defense">Allowed '+escapeHistoryHtml(game.opponentAllowed.toFixed(1))+
        '/game · '+escapeHistoryHtml(game.opponentDefenseGames)+' defensive games</small>'
      :"";
    const rawDate=String(game.date??"");
    const date=escapeHistoryHtml(readableGameDate(rawDate));
    const stat=escapeHistoryHtml(game.value);
    return '<div class="game-log-row" role="row">'+
      '<span class="game-log-date" role="cell">'+date+'</span>'+
      '<strong class="game-log-opponent" role="cell" title="'+opponent+'">'+opponent+comparableMetric+'</strong>'+
      '<strong class="game-log-stat" role="cell" aria-label="'+stat+' '+name+'">'+stat+'</strong>'+
      '<span class="game-log-status '+resultClass+'" role="cell">'+result+'</span>'+
      '</div>';
  }).join("");
  return '<section class="game-log-section" aria-label="'+escapeHistoryHtml(heading)+'">'+
    title+
    '<div class="game-log-table" role="table" aria-label="'+escapeHistoryHtml(heading)+' for '+name+'">'+
    '<div class="game-log-header" role="row"><span role="columnheader">Date</span><span role="columnheader">Opponent</span><span role="columnheader">'+name+'</span><span role="columnheader">Result</span></div>'+
    rows+'</div></section>';
}
