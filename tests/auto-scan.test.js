import test from "node:test";
import assert from "node:assert/strict";
import {
  CONFIG,extractBoxscore,priorGames,defensiveAverage,scanTrends
} from "../lib/auto-scan.js";
import {onRequestGet} from "../functions/api/scan.js";

function nflBox(teamId,dateValue){
  return {boxscore:{players:[{team:{id:String(teamId)},statistics:[
    {name:"passing",labels:["C/ATT","YDS"],athletes:[
      {athlete:{id:"p1",displayName:"Example QB"},stats:["22/35",String(dateValue)]}
    ]},
    {name:"rushing",labels:["CAR","YDS"],athletes:[
      {athlete:{id:"p1",displayName:"Example QB"},stats:["4","17"]}
    ]}
  ]}]}};
}
function finished(id,date,teamId,oppId,allowed){
  return {id,date,status:{type:{completed:true}},
    competitions:[{competitors:[
      {team:{id:String(teamId),displayName:"Offense"},score:String(20)},
      {team:{id:String(oppId),displayName:"Opponent"},score:String(allowed)}
    ]}]};
}
test("all six leagues have markets",()=>{
  assert.deepEqual(Object.keys(CONFIG).sort(),["mlb","nba","ncaab","ncaaf","nfl","soccer"].sort());
});
test("NFL passing stats and rushing totals are correctly distinguished",()=>{
  const p=extractBoxscore(nflBox("1",206),"nfl","1");
  assert.equal(p.length,1);
  assert.equal(p[0].stats.passingYards,206);
  assert.equal(p[0].stats.passCompletions,22);
  assert.equal(p[0].stats.passAttempts,35);
  assert.equal(p[0].stats.rushingYards,17);
});
test("does not accidentally include another team's player",()=>{
  assert.deepEqual(extractBoxscore(nflBox("1",200),"nfl","2"),[]);
});
test("NBA PRA and three pointers parsed from actual label",()=>{
  const box={boxscore:{players:[{team:{id:"3"},statistics:[{name:"starters",
    labels:["PTS","REB","AST","3PT"],athletes:[
      {athlete:{id:"p9",displayName:"Test G"},stats:["25","6","7","3-8"]}
    ]}]}]}};
  const p=extractBoxscore(box,"nba","3")[0];
  assert.equal(p.stats.pra,38);
  assert.equal(p.stats.threes,3);
});
test("MLB missing power-hitting component never invents total bases",()=>{
  const b={boxscore:{players:[{team:{id:"3"},statistics:[{name:"batting",
    labels:["H","R","RBI"],athletes:[{athlete:{id:"b1",displayName:"Batter"},stats:["2","1","1"]}]
  }]}]}};
  assert.equal(extractBoxscore(b,"mlb","3")[0].stats.totalBases,undefined);
});
test("only games finished BEFORE selected date qualify",()=>{
  const schedule={events:[
    finished("100","2026-09-01T18:00:00Z","1","2",14),
    finished("101","2026-09-08T18:00:00Z","1","3",19),
    {...finished("102","2026-09-15T18:00:00Z","1","4",21),status:{type:{completed:false}}}
  ]};
  assert.equal(priorGames(schedule,"1","2026-09-10T18:00:00Z").length,2);
});
test("defensive average only uses games before kickoff",()=>{
 const schedule={events:[
    finished("100","2026-09-01T18:00:00Z","2","3",14),
    finished("101","2026-09-08T18:00:00Z","2","3",20),
    finished("102","2026-09-15T18:00:00Z","2","3",23),
    finished("103","2026-09-30T18:00:00Z","2","3",45)
 ]};
 assert.equal(defensiveAverage(schedule,"2","2026-09-20T18:00:00Z"),19);
});
test("3/3 same-defense thresholds return 100% historical, not probability",()=>{
  const records=[
    {id:"a",date:"2026-09-01T10:00:00Z",opponent:"One",opponentId:"5",players:extractBoxscore(nflBox("1",175),"nfl","1")},
    {id:"b",date:"2026-09-08T10:00:00Z",opponent:"Two",opponentId:"6",players:extractBoxscore(nflBox("1",150),"nfl","1")},
    {id:"c",date:"2026-09-15T10:00:00Z",opponent:"Three",opponentId:"7",players:extractBoxscore(nflBox("1",185),"nfl","1")},
    {id:"d",date:"2026-09-22T10:00:00Z",opponent:"Four",opponentId:"8",players:extractBoxscore(nflBox("1",205),"nfl","1")}
  ];
  const profiles={
    "2":{target:20},"5":{a:18},"6":{b:22},"7":{c:21},"8":{d:28}
  };
  const p=scanTrends(records,{id:"1",name:"Team A",targetOpponentId:"2"},{id:"up",date:"2026-10-01T10:00:00Z",sport:"nfl"},profiles,"similar",3).find(p=>p.stat==="passingYards");
  assert.equal(p.line,149.5);
  assert.equal(p.matched,3);
  assert.equal(p.sample,3);
  assert.equal(p.recentSample,4);
  assert.match(p.marketSource,/NOT a PrizePicks/);
});
test("no data produces no picks",()=>{
  const picks=scanTrends([],{id:"1",name:"Team A",targetOpponentId:"2"},{id:"up",date:"2026-10-01T10:00:00Z",sport:"nfl"},{},"similar",3);
  assert.equal(picks.length,0);
});
test("scanner rejects invalid game ID without upstream calls",async()=>{
  const response=await onRequestGet({request:new Request("https://site.example/api/scan?sport=nfl&date=2026-10-08&gameId=broken")});
  assert.equal(response.status,400);
});
test("scanner rejects fabricated/unlisted games",async()=>{
  const old=globalThis.fetch;
  globalThis.fetch=async()=>new Response(JSON.stringify({events:[]}),{headers:{"Content-Type":"application/json"}});
  try{
    const response=await onRequestGet({request:new Request("https://site.example/api/scan?sport=nfl&date=2026-10-08&gameId=123456789")});
    assert.equal(response.status,404);
  }finally{globalThis.fetch=old;}
});
