/**
 * Last successful matchup scan saved locally, without extra provider requests.
 * A saved scan is HISTORICAL evidence, not a live bookmaker market. It can
 * never carry over to a different sport, league, date, game, or started game.
 */
const PREFIX="matchup-nightmare:last-completed:v1:";
export const MAX_CACHE_AGE_MS=7*24*60*60*1000;
const finite=n=>typeof n==="number"&&Number.isFinite(n);
const validInstant=s=>typeof s==="string"&&Number.isFinite(Date.parse(s));
const storageKey=(sport,date,league,id)=>PREFIX+
  [sport,date,league||"none",id].map(encodeURIComponent).join(":");

function validCard(c,fixtureId){
  return c&&String(c.fixtureId)===String(fixtureId)&&
    c.source==="PropLine"&&c.bookKey==="draftkings"&&
    c.offer?.source==="PropLine"&&c.offer?.bookKey!=="fanduel"&&
    (c.offer?.bookKey===undefined||c.offer?.bookKey==="draftkings")&&
    finite(c.line)&&c.line>=0&&validInstant(c.quotedAt)&&
    typeof c.stat==="string"&&typeof c.player==="string";
}
function validGame(game,now){
  const start=Date.parse(game?.date);
  return game?.id&&Number.isFinite(start)&&now<start;
}
/** Returns number of successfully stored game scans, and possible local storage errors. */
export function saveCompletedScan({sport,date,league,games,cards},storage,now=Date.now()){
  const savedAt=new Date(now).toISOString();
  let saved=0,failed=0;
  if(!storage||!Array.isArray(games)||!Array.isArray(cards))
    return {saved,failed:games?.length||0,savedAt};
  for(const game of games){
    if(!validGame(game,now))continue;
    const rows=cards.filter(c=>validCard(c,game.id));
    if(!rows.length)continue;
    const payload={format:1,sport,date,league:league||"none",
      gameId:String(game.id),gameKickoff:game.date,savedAt,cards:rows};
    try{
      storage.setItem(storageKey(sport,date,league,game.id),
        JSON.stringify(payload));
      saved++;
    }catch{failed++;}
  }
  return {saved,failed,savedAt};
}
/** Only reuse completed, source-derived research for exactly the chosen fixtures. */
export function readLastScan({sport,date,league,games},storage,now=Date.now()){
  const cards=[],missing=[],times=[];
  for(const game of games||[]){
    if(!validGame(game,now)){missing.push(String(game?.id||"unknown"));continue;}
    let payload=null;
    try{payload=JSON.parse(storage?.getItem(storageKey(sport,date,league,game.id))||"null");}
    catch{payload=null;}
    if(payload?.format!==1||payload.sport!==sport||payload.date!==date||
       payload.league!==(league||"none")||
       payload.gameId!==String(game.id)||payload.gameKickoff!==game.date||
       !validInstant(payload.savedAt)||
       Date.parse(payload.savedAt)>now||
       now-Date.parse(payload.savedAt)>MAX_CACHE_AGE_MS||
       Date.parse(payload.savedAt)>=Date.parse(game.date)||
       !Array.isArray(payload.cards)||!payload.cards.length){
      missing.push(String(game.id));continue;
    }
    // Never allow a saved quote to masquerade as a still-active/live offer.
    const rows=payload.cards.filter(c=>validCard(c,game.id)).map(c=>({
      ...c,cachedAt:payload.savedAt
    }));
    if(!rows.length){missing.push(String(game.id));continue;}
    cards.push(...rows);
    times.push(payload.savedAt);
  }
  return {cards,missing,coveredGames:times.length,
    newestSavedAt:times.length?times.sort().at(-1):null,
    oldestSavedAt:times.length?times[0]:null};
}
