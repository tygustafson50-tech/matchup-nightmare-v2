import {CONFIG,matchupRole} from "./auto-scan.js";

/** Rank CURRENT-season athletes for bounded automatic career enrichment.
 * This only controls which career lookbacks load first; low-volume players
 * remain eligible for a later on-demand history expansion.
 */
export function eligibleCareerPlayers(currentBatch,sport,maxPerTeam=6){
  const teams=currentBatch?.seasonBatch?.teams||[];
  const records=currentBatch?.seasonBatch?.records||{};
  const output=[],remaining=[];
  const markets=CONFIG[sport]?.markets||[];
  if(!markets.length)return {prioritized:[],remaining:[],total:0};
  for(const team of teams){
    const games=[...(records[team.id]||[])].filter(r=>Array.isArray(r.players))
      .sort((a,b)=>Date.parse(b.date)-Date.parse(a.date)).slice(0,3);
    const players=new Map();
    for(const g of games){
      for(const athlete of g.players){
        const id=String(athlete.id||"");
        if(!/^\d{2,15}$/.test(id))continue;
        const valid=markets.filter(([stat,,min])=>
          matchupRole(sport,athlete.position,stat) &&
          Number.isFinite(athlete.stats?.[stat])&&athlete.stats[stat]>=min);
        if(!valid.length)continue;
        const existing=players.get(id)||{playerId:id,teamId:String(team.id),
          name:athlete.name||"Player",appearances:0,markets:new Set(),
          maxStatStrength:0};
        existing.appearances++;
        for(const [stat,,min] of valid){
          existing.markets.add(stat);
          existing.maxStatStrength=Math.max(existing.maxStatStrength,
            Math.min(20,(athlete.stats[stat]||0)/Math.max(1,min)));
        }
        players.set(id,existing);
      }
    }
    const ranked=[...players.values()].sort((a,b)=>
      b.appearances-a.appearances||
      b.markets.size-a.markets.size||
      b.maxStatStrength-a.maxStatStrength||
      a.playerId.localeCompare(b.playerId));
    const serialize=p=>({
      playerId:p.playerId,teamId:p.teamId,name:p.name,
      appearances:p.appearances,marketCount:p.markets.size
    });
    output.push(...ranked.slice(0,maxPerTeam).map(serialize));
    remaining.push(...ranked.slice(maxPerTeam).map(serialize));
  }
  return {prioritized:output,remaining,total:output.length+remaining.length};
}
