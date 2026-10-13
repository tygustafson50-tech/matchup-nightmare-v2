/**
 * Never let repeated games versus the same opponent artificially fill the
 * 3–6 "similar defenses" list. Filter/rank by verified defensive fit BEFORE
 * checking today's sportsbook line or the player's OVER success.
 */
export const SIMILAR_DEFENSE_MIN=3;
export const SIMILAR_DEFENSE_MAX=6;
export function selectDistinctDefenseGames(rows,max=SIMILAR_DEFENSE_MAX){
  const sorted=[...(Array.isArray(rows)?rows:[])].sort((a,b)=>
    (b.similarity??0)-(a.similarity??0)||
    (a.matchTier??99)-(b.matchTier??99)||
    (a.rankDifference??99)-(b.rankDifference??99)||
    Date.parse(b.date)-Date.parse(a.date)||
    String(a.id).localeCompare(String(b.id)));
  const seen=new Set(),selected=[];
  for(const row of sorted){
    // Provider-verified team ID is authoritative. Fall back to normalized
    // team name only for old cached records without an ID.
    const team=String(row.opponentId||"").trim();
    const name=String(row.opponent||"").normalize("NFKD")
      .toLowerCase().replace(/[^a-z0-9]/g,"");
    const key=team?"id:"+team:name?"name:"+name:"game:"+String(row.id);
    if(seen.has(key))continue;
    seen.add(key);
    selected.push(row);
    if(selected.length>=max)break;
  }
  return selected;
}
