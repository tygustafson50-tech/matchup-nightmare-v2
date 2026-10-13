import test from "node:test";
import assert from "node:assert/strict";
import {saveCompletedScan,readLastScan,MAX_CACHE_AGE_MS}
  from "../public/lib/last-scan-cache.js";

const now=Date.parse("2026-10-11T21:30:00Z");
const game={id:"401001",date:"2026-10-12T01:15:00Z",
  home:{name:"Rams"},away:{name:"Bills"}};
const second={id:"401002",date:"2026-10-12T03:15:00Z"};
const scope=games=>({sport:"nfl",date:"2026-10-11",
  league:"eng.1",games});
const card=(id=game.id)=>({
  id:"source-id",fixtureId:id,
  source:"PropLine",bookKey:"draftkings",line:0.5,
  quotedAt:"2026-10-11T21:29:00Z",stat:"rushingYards",
  player:"Jordan Whittington",recommendation:"OVER",
  offer:{source:"PropLine",bookKey:"draftkings",espnPlayerId:"123"},
  recent:{hits:4,tracked:5,percent:80},
  similar:{hits:3,tracked:4,percent:75}
});
function memory(){
  const m=new Map();
  return {getItem:k=>m.get(k)??null,setItem:(k,v)=>m.set(k,v),
    removeItem:k=>m.delete(k),all:()=>[...m.entries()]};
}
test("last successful scan survives refresh in same browser without API calls",()=>{
  const storage=memory(),data=scope([game]);
  const s=saveCompletedScan({...data,cards:[card()]},storage,now);
  assert.equal(s.saved,1);
  const restored=readLastScan(data,storage,now+1000);
  assert.equal(restored.cards.length,1);
  assert.equal(restored.cards[0].line,0.5);
  assert.equal(restored.cards[0].cachedAt,s.savedAt);
  assert.equal(restored.coveredGames,1);
  assert.deepEqual(restored.missing,[]);
});
test("no cross-game, sport, date or soccer-league reuse",()=>{
  const storage=memory(),data=scope([game]);
  saveCompletedScan({...data,cards:[card()]},storage,now);
  const otherGame=readLastScan(scope([second]),storage,now+1000);
  assert.equal(otherGame.cards.length,0);
  for(const query of [
    {...data,sport:"nba"}, {...data,date:"2026-10-12"},
    {...data,league:"esp.1"}
  ])assert.equal(readLastScan(query,storage,now+1000).cards.length,0);
});
test("partial coverage displays only actually saved game research",()=>{
  const storage=memory();
  saveCompletedScan({...scope([game]),cards:[card()]},storage,now);
  const restored=readLastScan(scope([game,second]),storage,now+1000);
  assert.equal(restored.cards.length,1);
  assert.deepEqual(restored.missing,[second.id]);
});
test("kickoff and seven-day max age remove outdated betting research",()=>{
  const storage=memory(),data=scope([game]);
  saveCompletedScan({...data,cards:[card()]},storage,now);
  assert.equal(readLastScan(data,storage,Date.parse(game.date)).cards.length,0);
  const far={...game,date:new Date(now+MAX_CACHE_AGE_MS*2).toISOString()};
  const futureScope=scope([far]);
  saveCompletedScan({...futureScope,cards:[card(far.id)]},storage,now);
  assert.equal(readLastScan(futureScope,storage,now+MAX_CACHE_AGE_MS+1).cards.length,0);
});
test("invalid localStorage or browser privacy restrictions do not invent cache",()=>{
  const broken={getItem(){throw Error("unavailable")},setItem(){throw Error("full")}};
  const result=saveCompletedScan({...scope([game]),cards:[card()]},broken,now);
  assert.equal(result.saved,0);assert.equal(result.failed,1);
  assert.deepEqual(readLastScan(scope([game]),broken,now+1000).cards,[]);
});
test("rejects mismatched bookmaker identities, fake sources and invalid cache entries",()=>{
  const storage=memory(),data=scope([game]);
  const rejected=[
    {...card(),bookKey:"fanduel"},
    {...card(),source:"Research-only"},
    {...card(),line:NaN},
    {...card(),fixtureId:"other-match"},
    {...card(),offer:{source:"Research-only",bookKey:"draftkings"}}
  ];
  const saved=saveCompletedScan({...data,cards:rejected},storage,now);
  assert.equal(saved.saved,0);
  assert.equal(readLastScan(data,storage,now).cards.length,0);
});
test("tampered cached records cannot be represented as verified historical results",()=>{
  const storage=memory(),data=scope([game]);
  saveCompletedScan({...data,cards:[card()]},storage,now);
  const [key,value]=storage.all()[0];
  const item=JSON.parse(value);
  item.cards[0].bookKey="fanduel";
  storage.setItem(key,JSON.stringify(item));
  assert.equal(readLastScan(data,storage,now+1000).cards.length,0);
});


test("valid FanDuel and PrizePicks source cards survive quota fallback without inventing prices",()=>{
  const storage=memory(),data=scope([game]);
  const fanDuel={...card(),id:"fd-verified",bookKey:"fanduel",
    offer:{...card().offer,bookKey:"fanduel"}};
  const prizePicks={...card(),id:"pp-verified",bookKey:"prizepicks",
    price:null,offer:{...card().offer,bookKey:"prizepicks"}};
  const stored=saveCompletedScan({...data,cards:[fanDuel,prizePicks]},storage,now);
  assert.equal(stored.saved,1);
  const restored=readLastScan(data,storage,now+1000);
  assert.deepEqual(restored.cards.map(c=>c.bookKey),["fanduel","prizepicks"]);
  assert.equal(restored.cards[1].price,null);
  assert.ok(restored.cards.every(c=>c.cachedAt===stored.savedAt));
});
