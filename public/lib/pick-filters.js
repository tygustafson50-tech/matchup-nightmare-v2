/**
 * Matchup Nightmare pick-card filters.
 * Works on already-scanned research results only. Never changes scan
 * windows, source history, threshold calculations, or OVER-only behavior.
 */
export const FIXED_SCAN = Object.freeze({mode:"both",window:3,overOnly:true});
export const INITIAL_FILTERS = Object.freeze({
  search:"",game:"all",team:"all",market:"all",position:"all",
  trend:"all",evidence:"all",sort:"similar"
});
const norm=value=>String(value??"").trim().toLocaleLowerCase("en-US");
const uniqueSorted=values=>[...new Set(values.filter(Boolean))]
  .sort((a,b)=>String(a).localeCompare(String(b),"en-US",{numeric:true}));
const validNum=value=>Number.isFinite(value)?value:0;
const gameIdOf=pick=>String(pick?.sourceGame?.id??pick?.gameId??"");
const identityOf=pick=>String(pick?.teamId??"");
const similarityCount=pick=>Array.isArray(pick?.similarGames)
  ?pick.similarGames.filter(g=>Number.isFinite(g?.value)).length
  :Math.max(0,validNum(pick?.similarSample));
const compareSort=(a,b,sort)=>{
  const aSample=validNum(a.sample),bSample=validNum(b.sample);
  const aSimilar=similarityCount(a),bSimilar=similarityCount(b);
  const aRecent=validNum(a.recentHits)/Math.max(1,validNum(a.recentSample));
  const bRecent=validNum(b.recentHits)/Math.max(1,validNum(b.recentSample));
  const tie=()=>String(a.player||"").localeCompare(String(b.player||""))||
    String(a.market||"").localeCompare(String(b.market||""))||
    validNum(b.line)-validNum(a.line);
  switch(sort){
    case "player":return String(a.player||"").localeCompare(String(b.player||""))||
      String(a.market||"").localeCompare(String(b.market||""))||tie();
    case "market":return String(a.market||"").localeCompare(String(b.market||""))||
      String(a.player||"").localeCompare(String(b.player||""))||tie();
    case "line-high":return validNum(b.line)-validNum(a.line)||tie();
    case "line-low":return validNum(a.line)-validNum(b.line)||tie();
    case "sample":return bSample-aSample||bSimilar-aSimilar||tie();
    case "game-time":return String(a.sourceGame?.date??"").localeCompare(String(b.sourceGame?.date??""))||tie();
    default:
      // Verified similar-defense research first, then richest real sample.
      return (a.scanMode==="similar"?0:1)-(b.scanMode==="similar"?0:1)||
        bSimilar-aSimilar||bSample-aSample||bRecent-aRecent||tie();
  }
};

/** Every selectable value comes from ACTUAL returned player cards. */
export function getPickOptions(picks){
  const rows=Array.isArray(picks)?picks:[];
  const names=new Map(),games=new Map();
  for(const p of rows){
    const team=identityOf(p),game=gameIdOf(p);
    if(team&&p.teamName)names.set(team,String(p.teamName));
    if(game){
      const away=p.sourceGame?.away?.name,home=p.sourceGame?.home?.name;
      games.set(game,away&&home?away+" @ "+home:
        (p.sourceGame?.name||"Game "+game));
    }
  }
  const formatMap=map=>[...map.entries()]
    .map(([value,label])=>({value,label:String(label)}))
    .sort((a,b)=>a.label.localeCompare(b.label,"en-US"));
  return {
    games:formatMap(games),teams:formatMap(names),
    markets:uniqueSorted(rows.map(p=>p.market)),
    positions:uniqueSorted(rows.map(p=>p.position).filter(x=>norm(x)!=="unknown"))
  };
}

export function filterPickCards(picks,filters={}){
  const criteria={...INITIAL_FILTERS,...filters};
  const search=norm(criteria.search);
  const terms=search.split(/\s+/).filter(Boolean);
  const filtered=(Array.isArray(picks)?picks:[]).filter(p=>{
    if(criteria.game!=="all"&&gameIdOf(p)!==String(criteria.game))return false;
    if(criteria.team!=="all"&&identityOf(p)!==String(criteria.team))return false;
    if(criteria.market!=="all"&&p.market!==criteria.market)return false;
    if(criteria.position!=="all"&&p.position!==criteria.position)return false;
    if(criteria.trend!=="all"&&p.scanMode!==criteria.trend)return false;
    if(criteria.evidence==="similar-any"&&similarityCount(p)<1)return false;
    if(criteria.evidence==="similar-perfect"&&!(similarityCount(p)===4&&validNum(p.similarHits)===4))return false;
    if(criteria.evidence==="recent-five-perfect"&&!(validNum(p.recentSample)===5&&validNum(p.recentHits)===5))return false;
    if(terms.length){
      const game=p.sourceGame;
      const haystack=norm([
        p.player,p.teamName,p.position,p.market,p.stat,
        game?.home?.name,game?.away?.name,game?.id,
        p.matchupPosition
      ].join(" "));
      if(!terms.every(term=>haystack.includes(term)))return false;
    }
    return true;
  });
  return filtered.sort((a,b)=>compareSort(a,b,criteria.sort));
}
