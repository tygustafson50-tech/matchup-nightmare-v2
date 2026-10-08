import {extractBoxscore} from "./auto-scan.js";

/** ESPN common/v3 athlete game logs expose event identifiers across team moves.
 * The format is unofficial and varies by league; never infer unreported stats.
 */
export function parseCareerEventRefs(payload,season,cutoff,limit=10){
  const raw=payload?.events??payload?.games??payload?.gameLog;
  let entries=[];
  if(Array.isArray(raw))entries=raw.map(x=>[null,x]);
  else if(raw && typeof raw==="object")entries=Object.entries(raw);
  const seen=new Set();
  const out=[];
  for(const [key,event] of entries){
    if(!event || typeof event!=="object")continue;
    const id=String(event.id??event.eventId??event.event?.id??key??"");
    if(!/^\d{5,15}$/.test(id)||seen.has(id))continue;
    const date=event.date??event.gameDate??event.eventDate??event.event?.date??null;
    if(date && (!Number.isFinite(Date.parse(date)) || Date.parse(date)>=Date.parse(cutoff)))continue;
    const explicit=event.season?.year??event.seasonYear??null;
    if(explicit!==null&&Number(explicit)!==Number(season))continue;
    const opponent=event.opponent?.displayName??event.opponent?.name??event.opponentName??"";
    seen.add(id);
    out.push({id,date:date||null,opponent:opponent||null});
  }
  return out.sort((a,b)=>(Date.parse(b.date)||0)-(Date.parse(a.date)||0)).slice(0,limit);
}
export function seasonFromDate(sport,date){
  if(!date||!Number.isFinite(Date.parse(date)))return null;
  const y=Number(String(date).slice(0,4)),m=Number(String(date).slice(5,7));
  if(!Number.isInteger(y)||!Number.isInteger(m)||m<1||m>12)return null;
  if(sport==="nba"||sport==="ncaab")return m>=7?y+1:y;
  if(sport==="nfl"||sport==="ncaaf"||sport==="soccer")return m<7?y-1:y;
  return y;
}
/** A completed career event belongs to the actual player's verified team in
 * that game, not the team they currently play for. The old team's boxscore
 * supplies their exact stats, current team is never guessed from gamelog.
 */
export function athleteCareerAppearance(summary,sport,playerId,gameId,season,dateFallback=null){
  const clubs=summary?.boxscore?.players;
  if(!Array.isArray(clubs)||clubs.length!==2)return null;
  const found=[];
  for(const club of clubs){
    const id=String(club.team?.id??"");
    if(!/^\d+$/.test(id))continue;
    const athlete=extractBoxscore(summary,sport,id).find(p=>String(p.id)===String(playerId));
    if(athlete)found.push({id,athlete,teamName:club.team?.displayName??club.team?.name??"Previous team"});
  }
  if(found.length!==1)return null;
  const played=found[0];
  const opponent=clubs.find(t=>String(t.team?.id)!==played.id);
  const opponentId=String(opponent?.team?.id??"");
  if(!/^\d+$/.test(opponentId))return null;
  const date=summary?.header?.competitions?.[0]?.date??summary?.header?.events?.[0]?.date??dateFallback;
  if(!date||!Number.isFinite(Date.parse(date)))return null;
  // A gamelog supplied date can safely be used only if no header date exists.
  const providedYear=summary?.header?.events?.[0]?.season?.year??null;
  if(providedYear!==null && Number(providedYear)!==Number(season))return null;
  // Some soccer and college ESPN "season" labels differ. Prefer exact league
  // season metadata when present; conservatively reject a wrong calendar year.
  if(providedYear===null&&seasonFromDate(sport,date)!==Number(season))return null;
  if(String(played.athlete.id)!==String(playerId))return null;
  return {
    id:String(gameId),date,season:Number(season),
    playedTeamId:played.id,playedTeamName:played.teamName,
    opponentId,opponent:opponent.team?.displayName??opponent.team?.name??"Opponent",
    players:[played.athlete]
  };
}
