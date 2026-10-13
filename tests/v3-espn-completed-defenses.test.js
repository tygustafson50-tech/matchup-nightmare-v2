import test from "node:test";
import assert from "node:assert/strict";
import {completedTeamGames,playersFromBoxscore}
  from "../public/lib/evidence-client-v3.js";
import {buildDefenseContext,readDefenseGameContext,strictDefenseComparison}
  from "../public/lib/nfl-defense-depth.js";
import {analyzeVerifiedProp} from "../public/lib/research-v3.js";
import {selectDistinctDefenseGames} from "../public/lib/defense-selection.js";
const game=(id,date,complete)=>({
  id,date,season:{year:2026},
  competitions:[{status:{type:{
    name:complete?"STATUS_FINAL":"STATUS_SCHEDULED",
    state:complete?"post":"pre",completed:complete}},
    competitors:[{team:{id:"14",displayName:"Rams"}},
      {team:{id:"21",displayName:"Eagles"}}]
  }]
});
const scheduled={events:[
 game("401100001","2026-09-01T19:00:00Z",true),
 game("401100002","2026-09-08T19:00:00Z",true),
 game("401100003","2026-09-15T19:00:00Z",true),
 game("401100004","2026-09-22T19:00:00Z",false),
 game("401100005","2026-09-29T19:00:00Z",true)
]};
const summary={boxscore:{players:[
  {team:{id:"14"},statistics:[]},
  {team:{id:"21"},statistics:[
    {name:"rushing",labels:["CAR","YDS","AVG","TD"],
      athletes:[{athlete:{id:"4430737",displayName:"Actual Back"},
        stats:["12","64","5.3","1"]}]},
    {name:"receiving",labels:["REC","YDS","AVG","TD","TGTS"],
      athletes:[{athlete:{id:"4426515",displayName:"Actual Receiver"},
        stats:["5","73","14.6","0","8"]},
        {athlete:{id:"4430737",displayName:"Actual Back"},
          stats:["2","13","6.5","0","4"]}]}
  ]}
]}};
const verified=new Map([["4430737","RB"],["4426515","WR"]]);
const rank=(teamId,season,passRank=12,rushRank=9)=>({
  verified:true,teamId:String(teamId),season,
  passing:{rank:passRank,yardsPerGame:230},
  rushing:{rank:rushRank,yardsPerGame:115}
});
test("real team schedule stores final status inside competitions; no top-level event.status",()=>{
  assert.equal(scheduled.events[0].status,undefined);
  assert.equal(scheduled.events[0].competitions[0].status.type.completed,true);
  assert.deepEqual(completedTeamGames(scheduled,"14",
    "2026-09-25T00:00:00Z",2026).map(g=>g.id),
    ["401100003","401100002","401100001"]);
  const unplayed=completedTeamGames(scheduled,"14",
    "2026-10-02T00:00:00Z",2026);
  assert.equal(unplayed.length,4);
  assert.ok(!unplayed.some(x=>x.id==="401100004"));
});
test("source boxer no-position athletes are resolved by VERIFIED roster athlete IDs",()=>{
  const raw=playersFromBoxscore(summary,"nfl","21");
  assert.ok(raw.every(a=>!a.position));
  const enriched=playersFromBoxscore(summary,"nfl","21",verified);
  assert.equal(enriched.find(a=>a.id==="4430737").position,"RB");
  assert.equal(enriched.find(a=>a.id==="4426515").position,"WR");
  assert.equal(enriched.find(a=>a.id==="4426515").stats.receivingYards,73);
  assert.deepEqual(readDefenseGameContext(summary,"14","RB",
    "rushingYards",verified),{value:64,rbCatches:2,rbTargets:4});
  assert.deepEqual(readDefenseGameContext(summary,"14","WR",
    "receivingYards",verified),{value:73,rbCatches:2,rbTargets:4});
  assert.equal(readDefenseGameContext(summary,"14","WR",
    "receivingYards").value,null);
});
test("defensive pregame 3+ prior completed ESPN games restore verified positional sample",async()=>{
  const v=await buildDefenseContext({teamId:"14",season:2026,
    cutoff:"2026-09-25T00:00:00Z",role:"RB",
    stat:"rushingYards",schedule:async()=>scheduled,
    summary:async()=>summary,
    resolvePositions:async()=>verified});
  assert.equal(v.verifiedGames,3);
  assert.equal(v.roleAllowed,64);
  assert.equal(v.rbCatchesGames,3);
  assert.equal(v.rbReceptionsAllowed,2);
});
test("empty historical ESPN rosters use HONEST rank-only match, not zero invented coverage",()=>{
  const a=strictDefenseComparison({
    target:rank(2,2026),historical:rank(21,2025,14,11),
    role:"RB",stat:"rushingYards",targetContext:null,
    historicalContext:{verifiedGames:0,roleAllowed:null}
  });
  assert.equal(a.ok,true);
  assert.equal(a.positionCoverageVerified,false);
  assert.ok(a.matchTier>=3);
  assert.match(a.context,/Verified league ranks and yards only/);
  assert.match(a.context,/position coverage.*NOT VERIFIED/);
  assert.equal(a.roleAllowed,null);
  assert.equal(a.checkdownProxyVerified,false);
  // no bogus rank comparisons: missing actual source evidence still rejects.
  const b=strictDefenseComparison({
    target:null,historical:rank(21,2025,14,11),
    role:"RB",stat:"rushingYards",targetContext:null,
    historicalContext:null
  });
  assert.equal(b.ok,false);
});
test("rank-only matches cannot outrank position-verified matches based on lucky higher score",()=>{
  const chosen=selectDistinctDefenseGames([
    {id:"fallback",opponentId:"2",matchTier:3,similarity:99,
      date:"2025-10-01T00:00:00Z",actual:300},
    {id:"with-position",opponentId:"3",matchTier:1,similarity:75,
      date:"2025-10-01T00:00:00Z",actual:0}
  ]);
  assert.deepEqual(chosen.map(x=>x.id),["with-position","fallback"]);
});
test("3 true distinct rank-matched defenses yield populated similar results with actual ESPN stat totals",()=>{
  const offer={id:"hypothetical-test-only",source:"PropLine",
    sport:"nfl",status:"active",book:"DraftKings",bookKey:"draftkings",
    player:"ESPN Verified Player",espnPlayerId:"12",
    stat:"rushingYards",market:"Rushing yards",line:49.5,
    position:"RB",quotedAt:"2026-10-11T19:00:00Z",
    gameDateLocal:"2026-10-12",variant:"standard"};
  const games=[0,1,2].map(i=>({
    id:"40110000"+i,opponentId:String(31+i),
    opponent:"Verified Defense "+i,playerId:"12",
    stat:"rushingYards",actual:65+i*9,verified:true,
    sport:"nfl",season:2026,
    date:"2026-09-"+String(10+i).padStart(2,"0")+"T19:00:00Z",
    source:"ESPN game summary"
  }));
  const profiles=games.map((g,i)=>({...rank(g.opponentId,2026,11+i,9),
    gameId:g.id,context:null}));
  const c=analyzeVerifiedProp({offer,season:2026,games,
    upcomingDefense:rank(2,2026,12,9),upcomingContext:null,
    defensiveProfiles:profiles,matchupModel:"nfl-depth",
    now:"2026-10-12T18:00:00Z"});
  assert.equal(c.similar.tracked,3);
  assert.deepEqual(c.similarGames.map(x=>x.actual),[65,74,83]);
  assert.ok(c.similarGames.every(x=>x.defenseReason.includes("NOT VERIFIED")));
  assert.ok(c.similarGames.every(x=>x.matchTier>=3));
  assert.equal(c.recent.tracked,3);
});
