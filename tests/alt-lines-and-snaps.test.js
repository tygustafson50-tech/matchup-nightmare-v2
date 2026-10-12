import test from "node:test";
import assert from "node:assert/strict";
import {parseNflSnapCsv,attachNflSnapEvidence} from "../public/lib/nfl-snaps.js";
import {extractBoxscore} from "../public/lib/auto-scan.js";
import {playingTimeEligibility} from "../public/lib/participation.js";
import {chooseHistoricalAltLine} from "../public/lib/matchup-trends.js";
import {combineSeasonBatches} from "../public/lib/three-seasons.js";

const csv=[
  "game_id,pfr_game_id,season,game_type,week,player,pfr_player_id,position,team,opponent,offense_snaps,offense_pct,defense_snaps,defense_pct,st_snaps,st_pct",
  "2026_05_BUF_LAR,ignore,2026,REG,5,Josh Allen,AlleJo02,QB,BUF,LAR,60,0.50,0,0,0,0",
  "2026_05_BUF_LAR,ignore,2026,REG,5,\"D'Andre Swift\",SwifDA00,RB,BUF,LAR,40,0.71,0,0,0,0",
  "2026_06_BUF_LAR,ignore,2026,REG,6,Josh Allen,AlleJo02,QB,BUF,LAR,65,0.74,0,0,0,0",
  "2026_05_BUF_LAR,ignore,2025,REG,5,Josh Allen,AlleJo02,QB,BUF,LAR,60,0.99,0,0,0,0"
].join("\n");

test("nflverse snap CSV isolates season, team, opponent, player and week",()=>{
  const index=parseNflSnapCsv(csv,2026);
  const summary={boxscore:{players:[
    {team:{id:"2",abbreviation:"BUF"},statistics:[{
      name:"passing",labels:["CMP","ATT","YDS"],
      athletes:[{athlete:{id:"11",displayName:"Josh Allen"},stats:["17","25","210"]}]
    },{
      name:"rushing",labels:["CAR","YDS"],
      athletes:[{athlete:{id:"12",displayName:"D’Andre Swift"},stats:["5","33"]}]
    }]},
    {team:{id:"1",abbreviation:"LAR"},statistics:[]}
  ]}};
  const merged=attachNflSnapEvidence(summary,index,{week:5});
  const players=extractBoxscore(merged,"nfl","2");
  const allen=players.find(p=>p.id==="11"),swift=players.find(p=>p.id==="12");
  assert.equal(allen.playingTime.snapShare,0.5);
  assert.equal(allen.position,"QB");
  assert.equal(swift.playingTime.snapShare,0.71);
  assert.equal(swift.position,"RB");
  assert.equal(allen.playingTime.source,"nflverse/PFR");
  const eligible=playingTimeEligibility([allen],"nfl",{minimumGames:1});
  assert.equal(eligible.eligible,true,"Exactly 50 percent counts as eligible");
  assert.equal(attachNflSnapEvidence(summary,index,{week:7})._nflSnapShareByPlayerId?.["2"]?.["11"],undefined);
  assert.equal(attachNflSnapEvidence(summary,index)._nflSnapShareByPlayerId?.["2"]?.["11"],undefined,
    "Cannot guess when the same player had two meetings against the opponent");
});

test("alt lines use lowest verified 100%-hit outcome, even for very low props",()=>{
  const recent=[{value:2},{value:3},{value:1},{value:2},{value:4}];
  const similar=[{value:1},{value:4},{value:2},{value:5}];
  const result=chooseHistoricalAltLine(recent,similar);
  assert.equal(result.line,0.5);
  assert.equal(result.verified,false);
  assert.match(result.marketSource,/not an available or quoted/);
  assert.equal(chooseHistoricalAltLine([{value:0},...recent],similar),null);
  assert.equal(chooseHistoricalAltLine([{value:1}],[]).line,0.5);
});

function season(y,{missing=false}={}){
  const teams=[{id:"1",name:"BUF",targetOpponentId:"2"},
    {id:"2",name:"LAR",targetOpponentId:"1"}];
  const profile={"receivingYards|WR":{average:100,games:3,metricLabel:"WR yards allowed"}};
  const records={"1":[],"2":[]},defenseProfiles={};
  if(y===2026)defenseProfiles["2"]={target:profile};
  for(let i=0;i<(y===2026?5:4);i++){
    const g=y+"-"+i,opp="o-"+g;
    records["1"].push({id:g,date:y+"-09-"+String(i+3).padStart(2,"0")+"T19:00:00Z",
      season:y,opponentId:opp,opponent:"Opponent",
      players:[{id:"81",name:"Receiver",position:"WR",
        playingTime:{snapShare:0.65},stats:{receivingYards:y===2026?2+i:1+i}}]});
    if(!missing||i!==3)defenseProfiles[opp]={[g]:profile};
  }
  return {sport:"nfl",selectedSeason:2026,season:y,isCurrentSeason:y===2026,
    game:{id:"123456789",date:"2026-10-11T19:00:00Z",home:teams[0],away:teams[1]},
    seasonBatch:{season:y,teams,records,defenseProfiles},diagnostics:{offenseSchedules:2}};
}
test("alt-line scanner shows full 5/5 plus 4/4 at low OVER half-point",()=>{
  const r=combineSeasonBatches([season(2026),season(2025),season(2024)],
    {sport:"nfl",strict:true,altMode:true});
  const p=r.results.find(p=>p.playerId==="81"&&p.stat==="receivingYards");
  assert.ok(p);
  assert.equal(p.line,0.5);
  assert.equal(p.recentHits,5);assert.equal(p.similarHits,4);
  assert.equal(p.isFullyQualified,true);
});
test("alt-line scanner still includes recent 100% but labels missing fourth as partial",()=>{
  const r=combineSeasonBatches([season(2026),season(2025,{missing:true}),season(2024)],
    {sport:"nfl",strict:true,altMode:true});
  const p=r.results.find(p=>p.playerId==="81"&&p.stat==="receivingYards");
  assert.ok(p);
  assert.equal(p.recentHits,p.recentSample);
  assert.equal(p.isFullyQualified,false);
  assert.equal(p.isPartialMatchup,true);
});
