import test from "node:test";
import assert from "node:assert/strict";
import {
  CONFIG,extractBoxscore,priorGames,matchupRole,positionAllowedByGame,
  buildPositionProfile,scanTrends
} from "../lib/auto-scan.js";
import {onRequestGet} from "../functions/api/scan.js";

function teamBox(teamA,teamB,statsA,statsB,group="receiving",labels=["REC","YDS"]){
  const rows=(athletes)=>athletes.map(([id,pos,...values])=>({
    athlete:{id,displayName:"Athlete "+id,position:pos?{abbreviation:pos}:undefined},
    stats:values.map(String)
  }));
  return {boxscore:{players:[
    {team:{id:String(teamA)},statistics:[{name:group,labels,athletes:rows(statsA)}]},
    {team:{id:String(teamB)},statistics:[{name:group,labels,athletes:rows(statsB)}]}
  ]}};
}
function rate(average,games=2,metricLabel="Position stat allowed/game"){
  return {average,games,metricLabel,positionLabel:"Position"};
}
function ended(id,date,a,b){
  return {id:String(id),date,status:{type:{completed:true}},competitions:[{competitors:[
    {team:{id:String(a),displayName:"A"},score:"20"},
    {team:{id:String(b),displayName:"B"},score:"21"}
  ]}]};
}

test("all six sports are configured",()=>{
  assert.deepEqual(Object.keys(CONFIG).sort(),["nfl","nba","mlb","ncaaf","ncaab","soccer"].sort());
});

test("NFL receiving allowed isolates receivers from tight ends and running backs",()=>{
  const box=teamBox(1,2,[["a","WR",4,60],["b","WR",3,40],["c","TE",2,25],["d","RB",1,10]],[["e","WR",2,20]]);
  const values=positionAllowedByGame(box,"nfl",2);
  assert.equal(values["receivingYards|WR"].value,100);
  assert.equal(values["receivingYards|TE"].value,25);
  assert.equal(values["receptions|WR"].value,7);
  assert.equal(values["receivingYards|RB"].value,10);
});

test("NBA guard points conceded are distinct from centers",()=>{
  const box=teamBox(1,2,[["a","PG",21,4,5],["b","SG",15,2,3],["c","C",12,11,2]],[["z","PG",16,4,5]],
    "starters",["PTS","REB","AST"]);
  const values=positionAllowedByGame(box,"nba",2);
  assert.equal(values["points|G"].value,36);
  assert.equal(values["points|C"].value,12);
  assert.equal(values["rebounds|C"].value,11);
});

test("soccer forwards and midfielders use separate shots allowed",()=>{
  const box=teamBox(1,2,[["a","FW",3,2],["b","MF",2,1]],[["c","FW",2,1]],
    "players",["SH","SOT"]);
  const values=positionAllowedByGame(box,"soccer",2);
  assert.equal(values["shots|F"].value,3);
  assert.equal(values["shotsOnTarget|M"].value,1);
});

test("baseball batter props use pitching-staff matchup instead of invented defensive positions",()=>{
  const box=teamBox(1,2,[["a","1B",2,1,1,0],["b","CF",1,0,0,2]],[["c","SS",0,0,0,3]],
    "batting",["H","R","RBI","SO"]);
  const allowed=positionAllowedByGame(box,"mlb",2);
  assert.equal(allowed["hits|BATTERS"].value,3);
  assert.equal(allowed["pitcherKs|LINEUP"].value,3);
  assert.match(matchupRole("mlb","P","pitcherKs").metricLabel,/lineup/i);
});

test("unknown positive-stat position invalidates inaccurate aggregates",()=>{
  const box=teamBox(1,2,[["a","WR",4,60],["b","",3,40]],[["c","WR",1,20]]);
  assert.equal(positionAllowedByGame(box,"nfl",2)["receivingYards|WR"],undefined);
});

test("unavailable data never turns into an artificial defensive zero",()=>{
  assert.deepEqual(positionAllowedByGame({},"nfl",2),{});
  assert.deepEqual(buildPositionProfile([],"nba",2),{});
  assert.deepEqual(positionAllowedByGame(teamBox(1,2,[["a","",2,20]],[["z","WR",1,4]]),"nfl",2),{});
});

test("defensive profile requires two distinct completed game boxscores",()=>{
  const b1=teamBox(1,2,[["a","WR",4,70]],[["z","WR",2,10]]);
  const b2=teamBox(1,2,[["a","WR",3,90]],[["z","WR",2,20]]);
  assert.deepEqual(buildPositionProfile([{id:"a",summary:b1}],"nfl",2),{});
  const profile=buildPositionProfile([{id:"a",summary:b1},{id:"a",summary:b1},{id:"b",summary:b2}],"nfl",2);
  assert.equal(profile["receivingYards|WR"].average,80);
  assert.equal(profile["receivingYards|WR"].games,2);
});

test("pregame eligibility excludes future and incomplete games",()=>{
  const schedule={events:[
    ended(1,"2026-09-01T19:00:00Z",1,2),
    ended(2,"2026-09-08T19:00:00Z",1,3),
    {...ended(3,"2026-09-15T19:00:00Z",1,4),status:{type:{completed:false}}},
    ended(4,"2026-10-30T19:00:00Z",1,5)
  ]};
  assert.deepEqual(priorGames(schedule,1,"2026-10-08T19:00:00Z").map(g=>g.id),["2","1"]);
});

test("four latest matches use same stat AND same position, not team scoring",()=>{
  const t={id:"1",name:"Team One",targetOpponentId:"2"};
  const upcoming={sport:"nfl",id:"future",date:"2026-10-08T18:00:00Z"};
  const key="receivingYards|WR";
  const profiles={"2":{target:{[key]:rate(100,3,"WR receiving yards allowed/game")}}};
  const similarIndices=new Set([0,3,6,8,9]);
  const records=Array.from({length:10},(_,i)=>{
    const id="game"+i,opponentId=String(11+i);
    profiles[opponentId]={[id]:{[key]:rate(similarIndices.has(i)?105:160)}};
    return {id,date:"2026-09-"+String(i+1).padStart(2,"0")+"T19:00:00Z",
      opponent:"Opponent "+i,opponentId,
      players:[{id:"wr1",name:"Receiver",position:"WR",stats:{receivingYards:70+i*3}}]};
  });
  const pick=scanTrends(records,t,upcoming,profiles,"similar",3)
    .find(x=>x.stat==="receivingYards");
  assert.ok(pick);
  assert.deepEqual(pick.similarGames.map(x=>x.opponent),[
    "Opponent 9","Opponent 8","Opponent 6","Opponent 3"
  ]);
  assert.equal(pick.sample,4);
  assert.equal(pick.matched,4);
  assert.equal(pick.matchupPosition,"WR");
  assert.equal(pick.targetDefense,100);
  assert.equal(pick.similarGames[0].opponentAllowed,105);
  assert.equal(pick.targetDefenseGames,3);
});

test("recent-only trend remains available without inventing comparable defense",()=>{
  for(const sport of Object.keys(CONFIG)){
    const [stat,,min]=CONFIG[sport].markets[0];
    const position={nfl:"QB",nba:"PG",mlb:"DH",ncaaf:"QB",ncaab:"PG",soccer:"FW"}[sport];
    const records=Array.from({length:5},(_,i)=>({
      id:"e"+i,date:"2026-09-0"+(i+1)+"T20:00:00Z",
      opponentId:String(i+10),opponent:"Test Opponent",players:[{
        id:"p",name:"Test Player",position,stats:{[stat]:min+i+10}
      }]
    }));
    const team={id:"1",name:"Team",targetOpponentId:"2"};
    const game={id:"future",date:"2026-10-08T20:00:00Z",sport};
    const recent=scanTrends(records,team,game,{},"recent",3)[0];
    assert.ok(recent,sport);
    assert.equal(recent.scanMode,"recent");
    assert.equal(recent.similarGames.length,0);
    assert.equal(recent.targetDefense,null);
    assert.equal(scanTrends(records,team,game,{},"similar",3).length,0);
  }
});

test("scalar total team scoring is never accepted as a positional profile",()=>{
  const records=Array.from({length:5},(_,i)=>({
    id:"g"+i,date:"2026-09-0"+(i+1)+"T18:00:00Z",
    opponentId:String(i+10),opponent:"Team",players:[{
      id:"p",name:"WR",position:"WR",stats:{receivingYards:80+i}
    }]
  }));
  const profiles={"2":{target:20},"10":{"g0":20},"11":{"g1":21}};
  assert.deepEqual(scanTrends(records,{id:"1",name:"Home",targetOpponentId:"2"},
    {id:"future",date:"2026-10-08T20:00:00Z",sport:"nfl"},profiles,"similar",3),[]);
});

test("API rejects invalid game without requesting external data",async()=>{
  const r=await onRequestGet({request:new Request("https://example.pages.dev/api/scan?sport=nfl&date=2026-10-08&gameId=bad")});
  assert.equal(r.status,400);
});

test("API rejects a game missing from the requested official schedule",async()=>{
  const previous=globalThis.fetch;
  globalThis.fetch=async()=>new Response(JSON.stringify({events:[]}),{
    headers:{"content-type":"application/json"}
  });
  try{
    const r=await onRequestGet({request:new Request("https://example.pages.dev/api/scan?sport=nfl&date=2026-10-08&gameId=123456789")});
    assert.equal(r.status,404);
  }finally{globalThis.fetch=previous;}
});
