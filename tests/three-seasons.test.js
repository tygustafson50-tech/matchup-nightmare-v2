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

test("three-season window uses selected season plus two prior years",()=>{
  assert.deepEqual(seasonsFor(2026,3),[2026,2025,2024]);
  assert.deepEqual(seasonsFor(2026,1),[2026]);
  assert.throws(()=>seasonsFor(2026,2));
});

test("combined player card uses independent current-season line, not old matchup minimum",()=>{
  const combined=combineSeasonBatches([batch(2024),batch(2026),batch(2025)],
    {sport:"nfl",mode:"both",window:3});
  assert.deepEqual(combined.yearsLoaded,[2026,2025,2024]);
  const pick=combined.results.find(p=>p.teamId==="1"&&p.stat==="receivingYards");
  assert.ok(pick);
  assert.equal(pick.line,95.5);
  assert.equal(pick.recentSample,3);
  assert.equal(pick.recentHits,2);
  assert.equal(pick.similarSample,4);
  assert.equal(pick.similarHits,0);
  assert.equal(pick.similarPct,0);
  assert.deepEqual(pick.matchedSeasons,[2025,2024]);
  assert.deepEqual(pick.similarGames.map(g=>g.season),[2025,2025,2025,2024]);
  assert.deepEqual(pick.history.map(g=>g.season),[2026,2026,2026]);
  assert.equal(combined.results.filter(p=>p.teamId==="1"&&p.stat==="receivingYards").length,1);
  assert.match(pick.marketSource,/Research-only/);
});

test("missing year is honestly reported without manufactured missing games",()=>{
  const combined=combineSeasonBatches([batch(2026),batch(2025)],
    {sport:"nfl",window:3});
  assert.deepEqual(combined.yearsLoaded,[2026,2025]);
  assert.deepEqual(combined.yearsMissing,[2024]);
  assert.match(combined.notes.join(" "),/without usable current-team or verified career records/i);
  assert.ok(combined.results.every(p=>p.coveragePartial));
});

test("historical target defense must never override current upcoming opponent",()=>{
  const old=batch(2025);
  old.seasonBatch.defenseProfiles["2"]??={};
  old.seasonBatch.defenseProfiles["2"].target={
    "receivingYards|WR":{average:999,games:4,metricLabel:"STALE"}
  };
  const combined=combineSeasonBatches([batch(2026),old,batch(2024)],{sport:"nfl"});
  assert.equal(combined.results.find(p=>p.teamId==="1").targetDefense,100);
});

test("career-only athlete IDs are rejected without current team game evidence",()=>{
  const combined=combineSeasonBatches([
    batch(2026),batch(2025,{olderPlayers:true}),batch(2024,{olderPlayers:true})
  ],{sport:"nfl"});
  assert.equal(combined.results.some(p=>p.playerId.startsWith("former")),false);
  assert.ok(combined.results.every(p=>p.history.every(g=>g.season===2026)));
});

test("wrong sport and future games cannot enter historical samples",()=>{
  const wrong=batch(2025,{wrongSport:true}),old=batch(2024);
  old.seasonBatch.records["1"].push({
    id:"future",date:"2026-10-10T19:00:00Z",season:2024,
    opponent:"Future",opponentId:"991",players:[{
      id:"athlete1",name:"WR Team 1",position:"WR",stats:{receivingYards:900}
    }]
  });
  const combined=combineSeasonBatches([batch(2026),wrong,old,batch(2023)],
    {sport:"nfl"});
  assert.deepEqual(combined.yearsLoaded,[2026,2024]);
  assert.deepEqual(combined.yearsMissing,[2025]);
  assert.ok(combined.results.every(p=>
    !p.history.some(g=>g.gameId==="future")&&
    !p.similarGames.some(g=>g.gameId==="future")));
});

test("duplicate source games do not alter recent-game counts",()=>{
  const current=batch(2026),earlier=batch(2025);
  earlier.seasonBatch.records["1"].push({...current.seasonBatch.records["1"][0]});
  const combined=combineSeasonBatches([current,earlier,batch(2024)],
    {sport:"nfl"});
  const pick=combined.results.find(p=>p.teamId==="1");
  assert.equal(pick.recentSample,3);
  assert.equal(new Set(pick.history.map(g=>g.gameId)).size,pick.history.length);
});

test("no valid selected-season history blocks building player cards",()=>{
  assert.throws(()=>combineSeasonBatches([batch(2025),batch(2024)],
    {sport:"nfl"}),/Current-season/);
});

test("a single-season call excludes previous two seasons while preserving current last five",()=>{
  const out=combineSeasonBatches([batch(2026),batch(2025),batch(2024)],
    {sport:"nfl",window:1});
  assert.deepEqual(out.yearsLoaded,[2026]);
  assert.deepEqual(out.yearsMissing,[]);
  assert.ok(out.results.every(p=>p.history.every(g=>g.season===2026)));
  assert.ok(out.results.every(p=>p.similarSample===0));
});

test("empty historical year without player boxscores is flagged as missing",()=>{
  const empty=batch(2024);
  empty.seasonBatch.records={"1":[],"2":[]};
  const out=combineSeasonBatches([batch(2026),batch(2025),empty],
    {sport:"nfl"});
  assert.deepEqual(out.yearsMissing,[2024]);
  assert.match(out.notes.join(" "),/without usable current-team or verified career records/i);
});

test("position-stat history is unified in every sport; MLB hitters require real pitcher context",()=>{
  const currentPosition={nfl:"QB",nba:"PG",mlb:"DH",ncaaf:"QB",ncaab:"PG",soccer:"FW"};
  for(const sport of Object.keys(CONFIG)){
    const [stat,,min]=CONFIG[sport].markets[0];
    const position=currentPosition[sport],role=matchupRole(sport,position,stat);
    assert.ok(role,"Role not supported "+sport);
    const key=stat+"|"+role.role;
    const selected=[2026,2025,2024].map(year=>{
      const d=batch(year);
      d.sport=sport;
      for(const rowset of Object.values(d.seasonBatch.records)){
        for(const row of rowset){
          row.players=row.players.map(p=>({
            ...p,position,stats:{[stat]:min+10+(2026-year)*3}
          }));
        }
      }
      for(const item of Object.values(d.seasonBatch.defenseProfiles)){
        for(const id of Object.keys(item)){
          const rate=item[id]["receivingYards|WR"];
          item[id]={[key]:rate};
        }
      }
      return d;
    });
    const out=combineSeasonBatches(selected,{sport,window:3});
    const p=out.results.find(p=>p.teamId==="1"&&p.stat===stat);
    assert.ok(p,"Missing unified pick card "+sport);
    assert.equal(p.recentSample,3,sport);
    assert.equal(p.matchupPosition,role.label,sport);
    if(sport==="mlb"){
      assert.equal(p.similarSample,0,
        "Without starter handedness, staff totals cannot verify hitter similarity");
    }else{
      assert.equal(p.similarSample,4,sport);
      assert.deepEqual(p.matchedSeasons,[2025,2024],sport);
    }
  }
});

test("Verified former-team careers contribute only to true similar-defense samples",()=>{
  const historicalGameId="9000001",opponentId="777";
  const career={
    forTeamId:"1",sport:"nfl",gameId:game.id,playerId:"athlete1",
    careerBatch:{season:2025,playerId:"athlete1",sourceStatus:"partial",
      records:[{
        id:historicalGameId,date:"2025-09-27T19:00:00Z",season:2025,
        playedTeamId:"88",playedTeamName:"Former Franchise",
        opponentId,opponent:"Historical Opponent",players:[{
          id:"athlete1",name:"WR Team 1",position:"WR",
          stats:{receivingYards:125}
        }]
      }],
      defenseProfiles:{[opponentId]:{[historicalGameId]:{
        "receivingYards|WR":{average:100,games:2,metricLabel:"WR receiving yards allowed/game"}
      }}}
    }
  };
  const out=combineSeasonBatches([batch(2026),batch(2025),batch(2024)],
    {sport:"nfl",careerBatches:[career],careerEligibleCount:1});
  const p=out.results.find(p=>p.teamId==="1");
  assert.ok(p.careerTeamsIncluded.includes("88"));
  assert.ok(p.similarGames.some(g=>g.playedTeamId==="88"));
  assert.ok(p.careerSeasonsVerified.includes(2025));
  assert.ok(p.history.every(g=>g.season===2026));
});

test("Unverified career athlete and unrelated current team records are rejected",()=>{
  const unauthorized={
    forTeamId:"1",sport:"nfl",gameId:game.id,playerId:"other",
    careerBatch:{season:2025,playerId:"other",records:[{
      id:"9000002",date:"2025-09-11T19:00:00Z",season:2025,
      playedTeamId:"89",opponentId:"95",
      players:[{id:"other",name:"Other",position:"WR",stats:{receivingYards:900}}]
    }],defenseProfiles:{}}
  };
  const out=combineSeasonBatches([batch(2026),batch(2025),batch(2024)],
    {sport:"nfl",careerBatches:[unauthorized]});
  assert.equal(out.results.some(p=>p.playerId==="other"),false);
  assert.equal(out.results.some(p=>p.similarGames.some(g=>g.gameId==="9000002")),false);
});

test("a traded player this season adds only same-season games to Last Five",()=>{
  const trade={
    forTeamId:"1",sport:"nfl",gameId:game.id,playerId:"athlete1",
    careerBatch:{season:2026,playerId:"athlete1",sourceStatus:"partial",
      records:[{
        id:"trade2026",date:"2026-08-29T19:00:00Z",season:2026,
        playedTeamId:"99",playedTeamName:"Former Franchise",
        opponentId:"888",opponent:"Trade Game",players:[{
          id:"athlete1",name:"WR Team 1",position:"WR",
          stats:{receivingYards:105}
        }]
      }],defenseProfiles:{}}
  };
  const out=combineSeasonBatches([batch(2026),batch(2025),batch(2024)],
    {sport:"nfl",careerBatches:[trade]});
  const p=out.results.find(p=>p.teamId==="1");
  assert.equal(p.recentSample,4);
  assert.ok(p.history.some(g=>g.gameId==="trade2026"));
  assert.ok(p.history.every(g=>g.season===2026));
});

test("browser and server share exact positional parsing source",async()=>{
  const browser=await import("../public/lib/auto-scan.js");
  assert.equal(browser.matchupRole.toString(),matchupRole.toString());
});
