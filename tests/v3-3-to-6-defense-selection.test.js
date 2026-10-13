import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {selectDistinctDefenseGames,SIMILAR_DEFENSE_MIN,SIMILAR_DEFENSE_MAX}
  from "../public/lib/defense-selection.js";
import {strictDefenseGate,NFL_PRIMARY_RANK_BAND,
  NFL_PRIMARY_YARDS_TOLERANCE,NFL_SIMILAR_MIN,NFL_MAX_CANDIDATES}
  from "../public/lib/nfl-defense-depth.js";
import {deepStatSpec,makeDeepProfile,compareDeepDefense,
  STRICT_MIN_MATCHES,CLOSE_ALLOWED_TOLERANCE}
  from "../public/lib/sport-defense-depth.js";
const rank=(passRank,passYards,rushRank=12,rushYards=110)=>({
  verified:true,passing:{rank:passRank,yardsPerGame:passYards},
  rushing:{rank:rushRank,yardsPerGame:rushYards}
});
test("NFL qualifies within 5 passing ranks OR within 10 percent pass allowed",()=>{
  const current=rank(20,200);
  const byRank=strictDefenseGate(current,rank(25,250),"receivingYards");
  const byRate=strictDefenseGate(current,rank(30,215),"receivingYards");
  const neither=strictDefenseGate(current,rank(26,230),"receivingYards");
  assert.equal(NFL_PRIMARY_RANK_BAND,5);
  assert.equal(NFL_PRIMARY_YARDS_TOLERANCE,.1);
  assert.equal(byRank.ok,true);
  assert.equal(byRank.matchBasis,"within 5 defensive ranks");
  assert.equal(byRate.ok,true);
  assert.equal(byRate.matchBasis,"within 10% yards allowed");
  assert.equal(neither.ok,false);
  assert.equal(strictDefenseGate(current,rank(25,250),"rushingYards").ok,true);
});
test("close rank cannot mask wholly opposite other defense dimension",()=>{
  const current=rank(20,200,5,82);
  const bad=rank(22,209,32,175);
  assert.equal(strictDefenseGate(current,bad,"receivingYards").ok,false);
});
test("NCAA, NBA, NCAAB, MLB and soccer have 10% stat match plus verified alternate fit",()=>{
  for(const [sport,role,stat,league] of [
    ["ncaaf","WR","receivingYards",null],
    ["nba","PG","points",null],
    ["ncaab","G","assists",null],
    ["mlb","BATTER","hits",null],
    ["mlb","P","pitcherKs",null],
    ["soccer","F","shots","eng.1"]
  ]){
    const spec=deepStatSpec(sport,stat,role);
    const make=(allowed,volume,companion=10)=>makeDeepProfile({
      sport,role,stat,teamId:"100",gameId:"g1",
      season:2025,asOf:"2025-09-01T20:00:00Z",
      metrics:{allowed,volume},verifiedGames:4,league,
      secondaryStats:Object.fromEntries(spec.secondary.map(x=>[x,companion])),
      secondaryGames:Object.fromEntries(spec.secondary.map(x=>[x,4]))
    });
    const current=make(20,10);
    const direct=compareDeepDefense(current,make(21.5,13),{sport,role,stat,league});
    const alternate=compareDeepDefense(current,make(23,10.5,11),{sport,role,stat,league});
    const fail=compareDeepDefense(current,make(24,13),{sport,role,stat,league});
    assert.equal(direct.ok,true,sport+" direct");
    assert.equal(direct.matchBasis,"position allowance within 10%");
    assert.equal(alternate.ok,true,sport+" alternate");
    assert.match(alternate.matchBasis,/usage within 10%/);
    assert.equal(fail.ok,false,sport+" fail");
  }
  assert.equal(STRICT_MIN_MATCHES,3);
  assert.equal(CLOSE_ALLOWED_TOLERANCE,.1);
});
test("historical opponent defense appears ONCE despite playing it 3 times",()=>{
  const rows=[
    {id:"g1",opponentId:"14",opponent:"Rams",similarity:99,
      actual:0,date:"2026-09-20T12:00:00Z"},
    {id:"g2",opponentId:"14",opponent:"Rams",similarity:98,
      actual:150,date:"2025-09-20T12:00:00Z"},
    {id:"g3",opponentId:"14",opponent:"Rams",similarity:97,
      actual:150,date:"2024-09-20T12:00:00Z"},
    {id:"g4",opponentId:"2",opponent:"Bills",similarity:96,
      actual:0,date:"2025-10-20T12:00:00Z"},
    {id:"g5",opponentId:"3",opponent:"Bears",similarity:95,
      actual:100,date:"2025-10-22T12:00:00Z"},
    {id:"g6",opponentId:"4",opponent:"Jets",similarity:94,
      actual:100,date:"2025-10-26T12:00:00Z"}
  ];
  const result=selectDistinctDefenseGames(rows);
  assert.deepEqual(result.map(x=>x.id),["g1","g4","g5","g6"]);
  assert.equal(result.length,4);
  assert.equal(SIMILAR_DEFENSE_MIN,3);
  assert.equal(SIMILAR_DEFENSE_MAX,6);
  // Because one of the duplicate games won, any user's hit rate remains
  // based on actual selected evidence, not a biased best-over selection.
  assert.equal(result.filter(x=>x.actual>49.5).length,2);
});
test("incomplete verified team pool produces 0–2, never padded or synthetic",()=>{
  assert.equal(selectDistinctDefenseGames([]).length,0);
  assert.equal(selectDistinctDefenseGames([
    {id:"a",opponentId:"1",similarity:87},
    {id:"b",opponentId:"1",similarity:85},
    {id:"c",opponentId:"2",similarity:82}
  ]).length,2);
  assert.ok(NFL_MAX_CANDIDATES>16);
});
test("production NFL and other sports forward source opponent IDs to distinct selector",()=>{
  const engine=readFileSync(new URL("../public/lib/research-v3.js",import.meta.url),"utf8");
  const app=readFileSync(new URL("../public/app.js",import.meta.url),"utf8");
  assert.match(engine,/opponentId:g\.opponentId/);
  assert.match(engine,/selectDistinctDefenseGames|chooseDeepGames/);
  assert.match(app,/Distinct similar defenses \(3–6 target\)/);
});
