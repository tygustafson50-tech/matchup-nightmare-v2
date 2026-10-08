/**
 * Three pick-card filters shared across NFL, NBA, MLB, college football,
 * college basketball, and men's soccer. The research model is unchanged.
 */
export const FIXED_SCAN=Object.freeze({mode:"both",window:3,overOnly:true});
export const INITIAL_FILTERS=Object.freeze({
  market:"all",team:"all",position:"all"
});
const uniqueSorted=values=>[...new Set(values.filter(Boolean))]
  .sort((a,b)=>String(a).localeCompare(String(b),"en-US",{numeric:true}));
const countSimilar=p=>Array.isArray(p?.similarGames)
  ?p.similarGames.filter(g=>Number.isFinite(g?.value)).length
  :Number.isFinite(p?.similarSample)?p.similarSample:0;
function comparePickCards(a,b){
  // Keep the same default order: similar-defense trends, then evidence.
  const first=(a.scanMode==="similar"?0:1)-(b.scanMode==="similar"?0:1);
  if(first)return first;
  const similar=countSimilar(b)-countSimilar(a);
  if(similar)return similar;
  const sample=(Number.isFinite(b.sample)?b.sample:0)-(Number.isFinite(a.sample)?a.sample:0);
  if(sample)return sample;
  const recentRatio=p=>(Number.isFinite(p.recentHits)?p.recentHits:0)/
    Math.max(1,Number.isFinite(p.recentSample)?p.recentSample:0);
  const recent=recentRatio(b)-recentRatio(a);
  if(recent)return recent;
  return String(a.player||"").localeCompare(String(b.player||""))||
    String(a.market||"").localeCompare(String(b.market||""))||
    (Number.isFinite(b.line)?b.line:0)-(Number.isFinite(a.line)?a.line:0);
}
/** Only provide stats, teams, positions actually returned by this scan. */
export function getPickOptions(picks){
  const rows=Array.isArray(picks)?picks:[];
  const teamNames=new Map();
  for(const p of rows){
    const id=String(p.teamId??"");
    if(id&&p.teamName)teamNames.set(id,String(p.teamName));
  }
  return {
    markets:uniqueSorted(rows.map(p=>p.market)),
    teams:[...teamNames.entries()]
      .map(([value,label])=>({value,label}))
      .sort((a,b)=>a.label.localeCompare(b.label,"en-US")),
    positions:uniqueSorted(rows.map(p=>p.position)
      .filter(v=>String(v??"").toLowerCase()!=="unknown"))
  };
}
/** Filter the FULL scanned list, before paging. Does not mutate originals. */
export function filterPickCards(picks,filters={}){
  const criteria={...INITIAL_FILTERS,...filters};
  return (Array.isArray(picks)?picks:[]).filter(p=>
    (criteria.market==="all"||p.market===criteria.market)&&
    (criteria.team==="all"||String(p.teamId??"")===String(criteria.team))&&
    (criteria.position==="all"||p.position===criteria.position)
  ).sort(comparePickCards);
}
