/**
 * Collapsible, complete game-by-game research. Each closed section displays
 * its OVER hits / actually verified visible games. Expansion reveals the
 * exact stat on each game against today's selected sportsbook line.
 */
const escapeHtml=v=>String(v??"").replace(/[&<>"']/g,c=>({
  "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
}[c]));
const validActual=v=>typeof v==="number"&&Number.isFinite(v)&&v>=0;
const validLine=v=>typeof v==="number"&&Number.isFinite(v)&&v>=0;
const ordinalResult=(actual,line)=>actual>line?"OVER":
  actual<line?"UNDER":"PUSH";

export function renderVerifiedHistory({
  label,games,line,market,similar=false,formatDate=v=>v
}){
  const actualRows=(Array.isArray(games)?games:[]).filter(g=>
    g&&validActual(g.actual)&&validLine(line)&&
    typeof g.opponent==="string"&&g.opponent.trim()&&
    typeof g.date==="string"&&Number.isFinite(Date.parse(g.date)));
  const statName=String(market||"Recorded statistic").trim();
  const heading=escapeHtml(label||"Verified games");
  const count=actualRows.length;
  const overHits=actualRows.filter(g=>g.actual>line).length;
  const hitRate=count?overHits+"/"+count:"—";
  return '<details class="verified-game-history game-log-section'+
    (similar?' verified-similar-history':'')+
    '" aria-label="'+heading+'">'+
    '<summary class="verified-history-toggle">'+
      '<span class="verified-history-heading">'+
        '<span><h3>'+heading+'</h3><span class="verified-stat-context">'+
          escapeHtml(statName)+' · tap to see each actual game stat</span></span>'+
      '</span>'+
      '<span class="verified-history-summary-right">'+
        '<strong class="verified-history-hits" aria-label="'+overHits+
          ' OVER out of '+count+' verified games">'+hitRate+'</strong>'+
        '<small class="verified-history-count">'+count+
          ' verified game'+(count===1?'':'s')+'</small>'+
        '<span class="verified-history-chevron" aria-hidden="true"></span>'+
      '</span>'+
    '</summary>'+
    '<div class="verified-history-expanded">'+
    (count?
      '<div class="verified-game-list" role="table" aria-label="'+heading+
        ' and actual '+escapeHtml(statName)+'">'+
      '<div class="game-log-header" role="row">'+
        '<span role="columnheader">Date</span>'+
        '<span role="columnheader">Opponent</span>'+
        '<span role="columnheader">Actual '+escapeHtml(statName)+'</span>'+
        '<span role="columnheader">Result</span></div>'+
      actualRows.map(g=>{
        const result=ordinalResult(g.actual,line);
        const outcomeStyle=result==="OVER"?"over":
          result==="UNDER"?"below":"push";
        const value=escapeHtml(g.actual);
        const date=escapeHtml(formatDate(g.date));
        const against=escapeHtml(g.opponent);
        const rankNote=similar?'<div class="verified-defense-detail">'+
          (g.rankLane&&Number.isInteger(g.historicalRank)&&Number.isInteger(g.targetRank)
            ?escapeHtml(g.rankLane)+" defense: historical #"+
              escapeHtml(g.historicalRank)+" · upcoming #"+
              escapeHtml(g.targetRank)+
              " (season rankings) "
            :typeof g.similarity==="number"&&Number.isFinite(g.similarity)
              ?"Recorded similarity: "+escapeHtml(g.similarity)+"% ": "")+
          (g.defenseReason?escapeHtml(g.defenseReason):"")+
          '</div>':"";
        return '<div class="verified-game-entry">'+
          '<div class="game-log-row" role="row">'+
            '<span class="game-log-date" role="cell">'+date+'</span>'+
            '<strong class="game-log-opponent" role="cell" title="'+against+'">'+against+'</strong>'+
            '<div class="verified-actual-stat" role="cell">'+
              '<strong class="verified-actual-number">'+value+'</strong>'+
              '<small class="verified-actual-unit">'+escapeHtml(statName)+'</small>'+
              '<small class="verified-compare-line">vs current line '+escapeHtml(line)+'</small>'+
            '</div>'+
            '<strong class="game-log-status '+outcomeStyle+
              '" role="cell">'+result+'</strong>'+
          '</div>'+rankNote+'</div>';
      }).join("")+'</div>'+
      '<p class="verified-history-note">Each total is the actual recorded '+
        escapeHtml(statName).toLowerCase()+
        ' from that game, compared with the selected current DraftKings line ('+
        escapeHtml(line)+'). These are not historical sportsbook quotes.</p>'
      :'<div class="game-log-empty">No verified game statistics available for this comparison. No results were invented.</div>')+
    '</div></details>';
}
