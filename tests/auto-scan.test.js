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

test("NBA PG and SG concessions are measured separately from centers",()=>{
  const box=teamBox(1,2,[["a","PG",21,4,5],["b","SG",15,2,3],["c","C",12,11,2]],[["z","PG",16,4,5]],
    "starters",["PTS","REB","AST"]);
  const values=positionAllowedByGame(box,"nba",2);
  assert.equal(values["points|PG"].value,21);
  assert.equal(values["points|SG"].value,15);
  assert.equal(values["points|C"].value,12);
  assert.equal(values["points|G"],undefined);
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


test("full selected-game scan builds role-specific historical comparisons within free request budget",async()=>{
  const before=globalThis.fetch;
  const ts=d=>d+"T18:00:00Z";
  const completed=(id,date,a,b)=>({
    id:String(id),date:ts(date),status:{type:{completed:true}},
    competitions:[{competitors:[
      {team:{id:String(a),displayName:"Team "+a},score:"20"},
      {team:{id:String(b),displayName:"Team "+b},score:"30"}
    ]}]
  });
  const upcoming={id:"123456789",date:ts("2026-10-08"),season:{year:2026},
    competitions:[{competitors:[
      {homeAway:"home",team:{id:"1",displayName:"Home"}},
      {homeAway:"away",team:{id:"2",displayName:"Away"}}
    ]}]};
  const history={};
  for(const team of [1,2]){
    history[team]=Array.from({length:6},(_,i)=>completed(team*100+i,
      "2026-09-"+String(i*4+1).padStart(2,"0"),team,
      team===1?11+i:21+i));
  }
  function receivingBox(a,b,ay,by){
    const block=(id,yards)=>({
      team:{id:String(id)},statistics:[{name:"receiving",labels:["REC","YDS"],
        athletes:[{athlete:{id:"player"+id,displayName:"WR "+id,
          position:{abbreviation:"WR"}},stats:["7",String(yards)]}]}]
    });
    return {boxscore:{players:[block(a,ay),block(b,by)]}};
  }
  let requests=0;
  globalThis.fetch=async(url)=>{
    requests++;
    let response;
    if(url.includes("/scoreboard?"))response={events:[upcoming]};
    else if(url.includes("/teams/")){
      const id=Number(url.match(/teams\/(\d+)/)[1]);
      response={events:history[id]||[1,2,3].map(i=>completed(
        80000+id*10+i,"2026-08-"+String(i*6+4).padStart(2,"0"),id,900))};
    }else if(url.includes("/summary?event=")){
      const id=Number(url.match(/event=(\d+)/)[1]);
      if(id>=80000)response=receivingBox(Math.floor((id-80000)/10),900,20,89);
      else if(id>=200)response=receivingBox(2,21+id-200,90+id%6,100);
      else response=receivingBox(1,11+id-100,90+id%6,100);
    }else throw new Error("Unexpected mocked data source "+url);
    return new Response(JSON.stringify(response),{headers:{"content-type":"application/json"}});
  };
  try{
    const r=await onRequestGet({request:new Request(
      "https://test.example/api/scan?sport=nfl&date=2026-10-08&gameId=123456789&mode=both"
    )});
    assert.equal(r.status,200);
    const d=await r.json();
    assert.ok(requests<=46,"Cloudflare Free quota exceeded: "+requests);
    const match=d.results.find(p=>p.stat==="receivingYards"&&p.scanMode==="similar");
    assert.ok(match);
    assert.equal(match.matchupPosition,"WR");
    assert.match(match.matchupMetric,/WR receiving yards/);
    assert.equal(match.similarGames.length,4);
    assert.equal(match.similarGames[0].opponentDefenseGames,2);
    assert.equal(match.similarGames[0].opponentAllowed,89);
    assert.equal(match.matched,4);
    assert.ok(d.results.some(p=>p.scanMode==="recent"));
    assert.equal(d.realOddsConnected,false);
  }finally{globalThis.fetch=before;}
});


test("players who changed from WR to TE are not counted in current WR matchups",()=>{
  const team={id:"1",name:"Team",targetOpponentId:"2"};
  const target={"receivingYards|WR":{average:100,games:3,metricLabel:"WR receiving yards allowed/game"}};
  const profiles={"2":{target}};
  const records=Array.from({length:7},(_,i)=>{
    const role=i<3?"TE":"WR";
    const id="change"+i,opponentId="opp"+i;
    profiles[opponentId]={[id]:{"receivingYards|WR":{
      average:100,games:2,metricLabel:"WR receiving yards allowed/game"
    }}};
    return {id,date:(i<3?"2025-09-":"2026-09-")+String(3+i).padStart(2,"0")+"T18:00:00Z",
      opponent:"Team "+i,opponentId,
      players:[{id:"wr1",name:"Former TE, current WR",position:role,
        stats:{receivingYards:70+i}}]};
  });
  const result=scanTrends(records,team,{sport:"nfl",id:"up",
    date:"2026-10-08T18:00:00Z"},profiles,"similar",3);
  const p=result.find(r=>r.stat==="receivingYards");
  assert.ok(p);
  assert.equal(p.matchupPosition,"WR");
  assert.equal(p.similarGames.length,4);
  assert.ok(p.similarGames.every(g=>g.positionAtGame==="WR"));
  assert.ok(p.similarGames.every(g=>g.season===null));
});
