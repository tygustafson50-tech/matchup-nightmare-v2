/**
 * Verified NFL offensive participation: nflverse/PFR game-level snap counts.
 * Identity must match season, team, opponent, name and (when available) week.
 * Never infer >50% shares from boxscore production or roster "starter".
 */
const normalizedName=value=>String(value||"").normalize("NFKD")
  .replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/\b(jr|sr|ii|iii|iv|v)\b/g,"")
  .replace(/[^a-z0-9]/g,"");
const alias=raw=>{
  const v=String(raw||"").trim().toUpperCase();
  return ({LA:"LAR",STL:"LAR",WSH:"WAS",JAC:"JAX",ARZ:"ARI",SD:"LAC",OAK:"LV"})[v]||v;
};
const percentage=raw=>{
  const n=Number(String(raw||"").replace("%",""));
  if(!Number.isFinite(n)||n<0||n>100)return null;
  return n>1?n/100:n;
};
function csvRows(csv){
  const rows=[];let row=[],token="",quoted=false;
  for(let i=0;i<csv.length;i++){
    const ch=csv[i];
    if(ch==='"'){
      if(quoted&&csv[i+1]==='"'){token+='"';i++;}
      else quoted=!quoted;
    }else if(ch===","&&!quoted){row.push(token);token="";}
    else if((ch==="\n"||ch==="\r")&&!quoted){
      if(ch==="\r"&&csv[i+1]==="\n")i++;
      row.push(token);if(row.length>1)rows.push(row);row=[];token="";
    }else token+=ch;
  }
  if(token||row.length){row.push(token);rows.push(row);}
  return rows;
}
export function parseNflSnapCsv(csv,season){
  const data=csvRows(csv),heads=(data.shift()||[]).map(x=>x.trim().toLowerCase());
  const required=["season","week","player","position","team","opponent","offense_pct"];
  if(!required.every(key=>heads.includes(key)))
    throw Error("NFL snap-count feed missing necessary columns.");
  const result=new Map();
  for(const values of data){
    const item=Object.fromEntries(heads.map((head,i)=>[head,values[i]||""]));
    if(Number(item.season)!==Number(season))continue;
    const team=alias(item.team),opponent=alias(item.opponent);
    const name=normalizedName(item.player),week=Number(item.week);
    const share=percentage(item.offense_pct),position=String(item.position||"").toUpperCase();
    if(!team||!opponent||!name||!Number.isInteger(week)||week<1||
      share===null)continue;
    const record={team,opponent,name,week,share,position};
    const key=team+"|"+opponent+"|"+name;
    if(!result.has(key))result.set(key,[]);
    result.get(key).push(record);
  }
  return result;
}
function verifiedSnap(index,{team,opponent,player,week}){
  const matches=index?.get(alias(team)+"|"+alias(opponent)+"|"+normalizedName(player))||[];
  const exact=Number.isInteger(Number(week))&&Number(week)>0
    ?matches.filter(row=>row.week===Number(week))
    :matches;
  return exact.length===1?exact[0]:null;
}
export function attachNflSnapEvidence(summary,index,{week=null}={}){
  if(!index||!summary?.boxscore?.players)return summary;
  const rows=summary.boxscore.players;
  const byId={},positions={};
  for(const team of rows){
    const teamId=String(team.team?.id||""),abbr=team.team?.abbreviation;
    const opponent=rows.find(x=>String(x.team?.id)!==teamId);
    if(!teamId||!abbr||!opponent?.team?.abbreviation)continue;
    for(const category of team.statistics||[])for(const entry of category.athletes||[]){
      const a=entry.athlete||{},id=String(a.id||"");
      if(!id||!a.displayName&&!a.fullName)continue;
      const match=verifiedSnap(index,{team:abbr,opponent:opponent.team.abbreviation,
        player:a.displayName||a.fullName,week});
      if(!match)continue;
      byId[teamId]??={};positions[teamId]??={};
      byId[teamId][id]={share:match.share,source:"nflverse/PFR"};
      const original=a.position?.abbreviation||a.position?.shortDisplayName||
        a.positionAbbreviation||entry.position?.abbreviation||"";
      if(!original&&["QB","RB","WR","TE","FB","HB"].includes(match.position))
        positions[teamId][id]=match.position;
    }
  }
  const merged={...summary,_nflSnapShareByPlayerId:byId};
  if(!Object.keys(positions).length)return merged;
  // Do not overwrite ESPN's explicit positions; these hints only fill blanks.
  const old=merged._verifiedPositionIndex||{};
  const combined={...old};
  for(const [teamId,ids] of Object.entries(positions))
    combined[teamId]={...ids,...old[teamId]};
  return {...merged,_verifiedPositionIndex:combined};
}
