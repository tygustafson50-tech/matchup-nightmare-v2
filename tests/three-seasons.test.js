import test from "node:test";
import assert from "node:assert/strict";
import {combineSeasonBatches,seasonsFor} from "../public/lib/three-seasons.js";
import {scanTrends,CONFIG,matchupRole} from "../lib/auto-scan.js";

const game={id:"123456789",date:"2026-10-08T19:00:00Z",away:{name:"B"},home:{name:"A"}};
const teams=[
  {id:"1",name:"Team A",targetOpponentId:"2"},
  {id:"2",name:"Team B",targetOpponentId:"1"}
];

function batch(year,{missingBoxscores=0,wrongSport=false,olderPlayers=false}={}){
  const records={"1":[],"2":[]};
  const profiles={};
  for(const team of teams){
    if(year===2026){
      profiles[team.targetOpponentId]??={};
      profiles[team.targetOpponentId].target={
        "receivingYards|WR":{average:100,games:3,metricLabel:"WR receiving yards allowed/game"}
      };
    }
    for(let i=0;i<3;i++){
      const id=String(year*10000+Number(team.id)*100+i);
      const opponentId=String(year*1000+Number(team.id)*100+i);
      const value=year===2026?95+i:year===2025?70+i:40+i;
      const playerId=olderPlayers&&year!==2026?"former"+team.id:"athlete"+team.id;
      records[team.id].push({
        id,date:year+"-09-"+String(3+i*6).padStart(2,"0")+"T19:00:00Z",
        season:year,opponent:"Defense "+year+"-"+i,opponentId,
        players:[{id:playerId,name:"WR Team "+team.id,position:"WR",stats:{receivingYards:value}}]
      });
      profiles[opponentId]={[id]:{
        "receivingYards|WR":{
          average:year===2026?160:100,games:2,metricLabel:"WR receiving yards allowed/game"
        }
      }};
    }
  }
  return {
    sport:wrongSport?"nba":"nfl",game,season:year,selectedSeason:2026,
    isCurrentSeason:year===2026,
    diagnostics:{
      offenseSchedules:2,missingOffenseBoxscores:missingBoxscores,
      missingDefenseBoxscores:0,upstreamRequests:40
    },
    seasonBatch:{season:year,teams,records,defenseProfiles:profiles}
  };
}

test("three-season window includes selected season plus two prior seasons",()=>{
  assert.deepEqual(seasonsFor(2026,3),[2026,2025,2024]);
  assert.deepEqual(seasonsFor(2026,1),[2026]);
  assert.throws(()=>seasonsFor(2026,2));
});

test("recompute one historical threshold across three years instead of combining annual picks",()=>{
  const combined=combineSeasonBatches([batch(2024),batch(2026),batch(2025)],
    {sport:"nfl",mode:"both",window:3});
  assert.deepEqual(combined.yearsLoaded,[2026,2025,2024]);
  assert.deepEqual(combined.yearsMissing,[]);
  const pick=combined.results.find(x=>x.teamId==="1"&&x.scanMode==="similar");
  assert.ok(pick);
  assert.equal(pick.sample,4);
  assert.equal(pick.matched,4);
  assert.equal(pick.line,41.5); // 3 recent 2025 defenses plus 2024 low of 42
  assert.deepEqual(pick.matchedSeasons,[2025,2024]);
  assert.deepEqual(pick.similarGames.map(g=>g.season),[2025,2025,2025,2024]);
  assert.deepEqual(pick.history.map(g=>g.season),[2026,2026,2026]);
  assert.deepEqual(pick.seasonsRequested,[2026,2025,2024]);
});

test("a missing season is reported instead of filled with fictional games",()=>{
  const combined=combineSeasonBatches([batch(2026),batch(2025)],
    {sport:"nfl",mode:"similar",window:3});
  assert.deepEqual(combined.yearsLoaded,[2026,2025]);
  assert.deepEqual(combined.yearsMissing,[2024]);
  assert.match(combined.notes.join(" "),/without usable player records/i);
  assert.equal(combined.results.every(p=>p.coveragePartial),true);
});

test("current-season target defense never replaced with old season target values",()=>{
  const earlier=batch(2025);
  earlier.seasonBatch.defenseProfiles["2"]??={};
  earlier.seasonBatch.defenseProfiles["2"].target={
    "receivingYards|WR":{average:999,games:4,metricLabel:"STALE"}
  };
  const result=combineSeasonBatches([batch(2026),earlier,batch(2024)],
    {sport:"nfl",mode:"similar",window:3});
  const pick=result.results.find(p=>p.teamId==="1");
  assert.ok(pick);
  assert.equal(pick.targetDefense,100);
});

test("reject unvalidated players from past seasons who lack current team evidence",()=>{
  const result=combineSeasonBatches([batch(2026),batch(2025,{olderPlayers:true}),
    batch(2024,{olderPlayers:true})],{sport:"nfl",mode:"both",window:3});
  assert.equal(result.results.some(p=>p.playerId.startsWith("former")),false);
  assert.equal(result.results.some(p=>p.matchedSeasons.includes(2025)),false);
});

test("ignore cross-sport, out-of-window and future-dated records",()=>{
  const invalid=batch(2025,{wrongSport:true});
  const future=batch(2024);
  future.seasonBatch.records["1"].push({
    id:"fakeFuture",date:"2026-10-10T19:00:00Z",season:2024,
    opponent:"Future",opponentId:"991",players:[{
      id:"athlete1",name:"WR Team 1",position:"WR",stats:{receivingYards:900}
    }]
  });
  const result=combineSeasonBatches([batch(2026),invalid,future,batch(2023)],
    {sport:"nfl",mode:"recent",window:3});
  assert.deepEqual(result.yearsLoaded,[2026,2024]);
  assert.deepEqual(result.yearsMissing,[2025]);
  assert.equal(result.results.some(p=>p.history.some(g=>g.gameId==="fakeFuture")),false);
});

test("deduplicate identical source games across repeated records",()=>{
  const selected=batch(2026);
  const oldest=batch(2024),other=batch(2025);
  other.seasonBatch.records["1"].push({...selected.seasonBatch.records["1"][0]});
  const result=combineSeasonBatches([selected,other,oldest],
    {sport:"nfl",mode:"recent",window:3});
  const pick=result.results.find(p=>p.teamId==="1"&&p.scanMode==="recent");
  assert.ok(pick);
  assert.equal(new Set(pick.history.map(g=>g.gameId)).size,pick.history.length);
});

test("missing current season blocks unverified roster-based picks",()=>{
  assert.throws(()=>combineSeasonBatches([batch(2025),batch(2024)],
    {sport:"nfl",mode:"similar",window:3}),/Current-season/);
});

test("single-season mode does not import older history",()=>{
  const result=combineSeasonBatches([batch(2026),batch(2025),batch(2024)],
    {sport:"nfl",mode:"recent",window:1});
  assert.deepEqual(result.yearsLoaded,[2026]);
  assert.deepEqual(result.yearsMissing,[]);
  assert.equal(result.results.some(p=>p.matchedSeasons.includes(2025)),false);
  assert.ok(result.count>0); // three recorded games exist in selected season\n  assert.ok(result.results.every(p=>p.history.every(g=>g.season===2026)));
});

test("keeps recent-form trends separate from multi-year similar-defense trends",()=>{
  const result=combineSeasonBatches([batch(2026),batch(2025),batch(2024)],
    {sport:"nfl",mode:"both",window:3});
  assert.ok(result.results.some(p=>p.scanMode==="recent"));
  assert.ok(result.results.some(p=>p.scanMode==="similar"));
  assert.equal(result.results.some(p=>p.seasonsLoaded.length!==3),false);
});

test("backend core exports same scanner used in the browser",async()=>{
  const browser=await import("../public/lib/auto-scan.js");
  assert.equal(browser.scanTrends.toString(),scanTrends.toString());
});


test("an empty 2024 response is not counted as a loaded historical season",()=>{
  const empty=batch(2024);
  empty.seasonBatch.records={"1":[],"2":[]};
  const result=combineSeasonBatches([batch(2026),batch(2025),empty],
    {sport:"nfl",mode:"similar",window:3});
  assert.deepEqual(result.yearsLoaded,[2026,2025]);
  assert.deepEqual(result.yearsMissing,[2024]);
  assert.match(result.notes.join(" "),/without usable player records/);
});


test("three-season position-specific comparison works for all six sports",()=>{
  const currentPosition={nfl:"QB",nba:"PG",mlb:"DH",ncaaf:"QB",ncaab:"PG",soccer:"FW"};
  for(const sport of Object.keys(CONFIG)){
    const [stat,,min]=CONFIG[sport].markets[0];
    const position=currentPosition[sport];
    const role=matchupRole(sport,position,stat);
    assert.ok(role,"Missing role for "+sport);
    const key=stat+"|"+role.role;
    const seasons=[2026,2025,2024].map(year=>{
      const data=batch(year);
      data.sport=sport;
      for(const rowset of Object.values(data.seasonBatch.records)){
        for(const record of rowset){
          record.players=record.players.map(p=>({
            ...p,position,stats:{[stat]:min+10+(2026-year)*3}
          }));
        }
      }
      for(const obj of Object.values(data.seasonBatch.defenseProfiles)){
        for(const id of Object.keys(obj)){
          const old=obj[id]["receivingYards|WR"];
          obj[id]={[key]:old};
        }
      }
      return data;
    });
    const result=combineSeasonBatches(seasons,{sport,window:3,mode:"similar"});
    const pick=result.results.find(p=>p.teamId==="1"&&p.stat===stat);
    assert.ok(pick,"No comparable historical matches for "+sport);
    assert.equal(pick.sample,4,sport);
    assert.deepEqual(pick.matchedSeasons,[2025,2024],sport);
    assert.equal(pick.matchupPosition,role.label,sport);
  }
});


test("Last 5 is current season even if previous seasons have many games",()=>{
  const result=combineSeasonBatches([batch(2026),batch(2025),batch(2024)],
    {sport:"nfl",mode:"both",window:3});
  for(const pick of result.results){
    assert.equal(pick.recentSeason,2026);
    assert.equal(pick.recentSample,3);
    assert.deepEqual(pick.history.map(g=>g.season),[2026,2026,2026]);
  }
  const similar=result.results.find(p=>p.scanMode==="similar");
  assert.ok(similar);
  assert.deepEqual(similar.similarGames.map(g=>g.season),[2025,2025,2025,2024]);
});

test("traded player contributes verified former-team game to comparable sample, not recent",()=>{
  const selected=batch(2026),older=batch(2025);
  const profiles=older.seasonBatch.defenseProfiles;
  const gameId="9000001",opponentId="777";
  const oldPlayer={id:"athlete1",name:"WR Team 1",position:"WR",
    stats:{receivingYards:125}};
  const career={
    forTeamId:"1",sport:"nfl",gameId:game.id,playerId:"athlete1",
    careerBatch:{
      season:2025,playerId:"athlete1",sourceStatus:"partial",
      records:[{
        id:gameId,date:"2025-09-27T19:00:00Z",season:2025,
        playedTeamId:"88",playedTeamName:"Former Franchise",
        opponentId,opponent:"Previous Opponent",players:[oldPlayer]
      }],
      defenseProfiles:{[opponentId]:{
        [gameId]:{"receivingYards|WR":{
          average:100,games:2,metricLabel:"WR receiving yards allowed/game"
        }}
      }}
    },
    warnings:["Historical provider is partial."]
  };
  const result=combineSeasonBatches([selected,older,batch(2024)],
    {sport:"nfl",mode:"similar",window:3,
      careerBatches:[career],careerEligibleCount:1});
  const p=result.results.find(p=>p.teamId==="1");
  assert.ok(p);
  assert.ok(p.careerTeamsIncluded.includes("88"));
  assert.ok(p.similarGames.some(g=>g.playedTeamId==="88"));
  assert.equal(p.history.some(g=>g.season!==2026),false);
  assert.ok(p.careerSeasonsVerified.includes(2025));
});

test("career records for another athlete or out-of-window season are rejected",()=>{
  const invalid={
    forTeamId:"1",sport:"nfl",gameId:game.id,playerId:"intruder",
    careerBatch:{season:2025,playerId:"intruder",records:[{
      id:"fake",date:"2025-09-10T19:00:00Z",season:2025,
      playedTeamId:"44",opponentId:"6",players:[{
        id:"intruder",name:"Intruder",position:"WR",stats:{receivingYards:999}
      }]
    }],defenseProfiles:{}}
  };
  const res=combineSeasonBatches([batch(2026),batch(2025),batch(2024)],
    {sport:"nfl",mode:"similar",window:3,careerBatches:[invalid]});
  assert.equal(res.results.some(p=>p.playerId==="intruder"),false);
  assert.equal(res.results.some(p=>p.similarGames.some(g=>g.gameId==="fake")),false);
});

test("same event on former teams is kept distinct for two currently eligible athletes",()=>{
  const selected=batch(2026);
  const [playerA,playerB]=["athlete1","athlete2"];
  const makeCareer=(forTeamId,playerId,playedTeamId,opponentId)=>({
    forTeamId,sport:"nfl",gameId:game.id,playerId,
    careerBatch:{
      season:2025,playerId,sourceStatus:"partial",
      records:[{
        id:"sameHistoricMatch",date:"2025-09-27T19:00:00Z",season:2025,
        playedTeamId,opponentId,opponent:"Old Rival",
        players:[{id:playerId,name:playerId,position:"WR",
          stats:{receivingYards:70}}]
      }],
      defenseProfiles:{}
    }
  });
  const a=makeCareer("1",playerA,"81","82");
  const b=makeCareer("2",playerB,"82","81");
  const res=combineSeasonBatches([selected,batch(2025),batch(2024)],{
    sport:"nfl",mode:"recent",window:3,careerBatches:[a,b]
  });
  assert.ok(res.results.every(p=>p.history.every(g=>g.season===2026)));
});
