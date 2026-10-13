import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {loadVerifiedEvidence} from "../public/lib/evidence-client-v3.js";

const game={id:"401999111",date:"2026-10-16T23:15:00Z",season:2026,
  home:{id:"1",name:"Seattle Seahawks"},away:{id:"2",name:"Denver Broncos"}};
function clientFor(players){
  return {call:async p=>{
    if(p.kind==="roster")return {athletes:[{items:p.teamId==="1"?players:[]}]};
    if(p.kind==="gamelog")return {events:{}};
    if(p.kind==="teamstats")return {results:{opponent:[]}};
    if(p.kind==="schedule")return {events:[]};
    throw Error("Unexpected ESPN resource: "+p.kind);
  }};
}
const makePlayer=(id,displayName)=>({id:String(id),displayName,
  position:{abbreviation:"WR"}});

test("initials in sportsbook prop are matched only to unique ESPN roster identity",async()=>{
  const out=await loadVerifiedEvidence({client:clientFor([
    makePlayer(44,"Jaxon Smith-Njigba")]),
    game,offer:{source:"PropLine",sport:"nfl",
      player:"J. Smith-Njigba",stat:"receptions",espnPlayerId:null}});
  assert.equal(out.player.id,"44");
  assert.equal(out.player.position,"WR");
  assert.equal(out.team.id,"1");
});
test("unknown first names cannot be guessed from matching surnames",async()=>{
  await assert.rejects(()=>loadVerifiedEvidence({
    client:clientFor([makePlayer(10,"Jaxon Smith-Njigba")]),
    game,offer:{source:"PropLine",sport:"nfl",
      player:"John Smith-Njigba",stat:"receptions",espnPlayerId:null}
  }),/uniquely confirmed/);
});
test("ambiguous initial aliases reject multiple distinct ESPN athletes",async()=>{
  await assert.rejects(()=>loadVerifiedEvidence({
    client:clientFor([makePlayer(10,"John Smith"),makePlayer(20,"James Smith")]),
    game,offer:{source:"PropLine",sport:"nfl",
      player:"J. Smith",stat:"receptions",espnPlayerId:null}
  }),/uniquely confirmed/);
});
test("published ESPN player ID takes precedence over similar or identical names",async()=>{
  const out=await loadVerifiedEvidence({
    client:clientFor([makePlayer(10,"John Smith"),makePlayer(20,"John Smith")]),
    game,offer:{source:"PropLine",sport:"nfl",
      player:"John Smith",stat:"receptions",espnPlayerId:"20"}
  });
  assert.equal(out.player.id,"20");
});
test("conflicting bookmaker IDs do not automatically withhold an entire player/stat group",()=>{
  const app=readFileSync(new URL("../public/app.js",import.meta.url),"utf8");
  assert.match(app,/group\.identityConflict\?\s*\{\.\.\.selectedOffer,espnPlayerId:null\}/);
  assert.match(app,/quote\.espnPlayerId&&String\(quote\.espnPlayerId\)!==input\.player\.id/);
  assert.doesNotMatch(app,/if\(group\.identityConflict\)throw/);
});
test("already-started fixtures never trigger a stale board scan",()=>{
  const app=readFileSync(new URL("../public/app.js",import.meta.url),"utf8");
  assert.match(app,/games=data\.games\.filter\(/);
  assert.match(app,/chosen\.some\(g=>Date\.parse\(g\.date\)<=Date\.now\(\)\)/);
});
