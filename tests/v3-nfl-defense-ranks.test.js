import test from "node:test";
import assert from "node:assert/strict";
import {parseFootballDefenseRanks,footballDefenseLane,
  compareFootballDefenseRanks,DEFENSE_RANK_BAND}
  from "../public/lib/football-defense-ranks.js";
import {analyzeVerifiedProp} from "../public/lib/research-v3.js";
import {readFileSync} from "node:fs";

const source=(year,teamId,passRank,rushRank)=>({
  requestedSeason:year,team:{id:String(teamId)},results:{opponent:[
    {name:"passing",stats:[
      {name:"netPassingYards",rank:passRank,
        perGameValue:145.5,rankDisplayValue:passRank+"th"},
      {name:"netPassingYardsPerGame",rank:33-passRank,perGameValue:145.5}
    ]},
    {name:"rushing",stats:[{name:"rushingYards",
      rank:rushRank,perGameValue:102,
      rankDisplayValue:rushRank+"th"}]}
  ]}
});
const parsed=(y,id,p,r)=>parseFootballDefenseRanks(source(y,id,p,r),
  {season:y,teamId:id});

test("ESPN team opponent stats are decoded as PASSING and RUSHING defense ranks",()=>{
  const result=parsed(2026,14,2,11);
  assert.equal(result.passing.rank,2);
  assert.equal(result.rushing.rank,11);
  assert.equal(result.passing.yardsPerGame,145.5);
  assert.equal(result.rushing.yardsPerGame,102);
  assert.equal(result.scope,"season aggregate (not pregame)");
  assert.equal(result.source,"ESPN opponent team statistics");
  assert.equal(result.passing.statName,"netPassingYards");
});
test("do not replace passing rank with per-game inverted ordering or offensive rank",()=>{
  const data=source(2026,14,2,11);
  data.results.opponent[0].stats[0].rank=null;
  assert.equal(parseFootballDefenseRanks(data,{season:2026,teamId:14}),null);
  assert.equal(parseFootballDefenseRanks(source(2025,14,3,12),
    {season:2026,teamId:14}),null);
  assert.equal(parseFootballDefenseRanks(source(2026,14,3,12),
    {season:2026,teamId:2}),null);
});
test("rush yards, carries and rushing TDs use RUSH defense rank; receptions and WR/TE/QB passing props use PASS",()=>{
  for(const stat of ["rushingYards","rushAttempts","rushingTDs"])
    assert.equal(footballDefenseLane(stat),"rushing");
  for(const stat of ["passingYards","passCompletions","passAttempts",
    "passingTDs","receptions","receivingYards","targets","receivingTDs"])
    assert.equal(footballDefenseLane(stat),"passing");
  assert.equal(footballDefenseLane("madeUpMarket"),null);
});
test("match defenses within three places: #28 current matches #25 through #31 historical, not #24 or #32",()=>{
  const current=parsed(2026,14,28,2);
  for(const rank of [25,26,27,28,29,30,31]){
    const historical=parsed(2024,rank,rank,29);
    const test=compareFootballDefenseRanks(current,historical,"receivingYards");
    assert.equal(test.ok,true,"rank "+rank);
    assert.equal(test.targetRank,28);
    assert.equal(test.historicalRank,rank);
    assert.match(test.context,/2024/);
    assert.match(test.context,/after the historical matchup/);
  }
  for(const rank of [24,32]){
    const historical=parsed(2024,rank,rank,4);
    assert.equal(compareFootballDefenseRanks(current,historical,"receivingYards").ok,false);
  }
  assert.equal(DEFENSE_RANK_BAND,3);
});
test("rushing comparable opponents are selected independently of their passing rank",()=>{
  const current=parsed(2026,14,32,27);
  const past=parsed(2025,24,1,28);
  assert.equal(compareFootballDefenseRanks(current,past,"rushingYards").ok,true);
  assert.equal(compareFootballDefenseRanks(current,past,"receivingYards").ok,false);
});
test("one 3-season recent+similar OVER model uses real opponent ranks and exact sourced quote, without inventing games",()=>{
  const offer={id:"real-propline-id",sport:"nfl",stat:"receivingYards",
    market:"Receiving yards",source:"PropLine",book:"DraftKings",bookKey:"draftkings",
    status:"active",position:"WR",player:"Test Receiver",team:"Bills",
    opponent:"Rams",line:49.5,variant:"standard",quotedAt:
      "2026-10-11T19:00:00Z",gameDateLocal:"2026-10-12",espnPlayerId:"22"};
  const upcoming=parsed(2026,14,28,2),profiles=[],games=[];
  const gameResults=[
    [2026,"31",30,80],[2026,"13",26,64],[2026,"21",24,55],
    [2026,"22",28,30],[2026,"18",31,91],
    [2025,"1",25,73],[2025,"3",32,140],[2024,"5",27,71],
    [2023,"9",28,150]];
  gameResults.forEach(([year,oppId,rank,actual],i)=>{
    const id="ev"+i,date=year+"-09-"+String(i+1).padStart(2,"0")+"T19:00:00Z";
    games.push({id,date,season:year,sport:"nfl",playerId:"22",
      stat:"receivingYards",actual,opponentId:oppId,
      opponent:"Defense #"+rank,team:"Buffalo Bills",verified:true,
      source:"ESPN boxscore"});
    profiles.push({...parsed(year,oppId,rank,15),gameId:id});
  });
  const result=analyzeVerifiedProp({offer,season:2026,games,
    upcomingDefense:upcoming,defensiveProfiles:profiles,
    matchupModel:"nfl-ranks"});
  assert.ok(result);
  assert.equal(result.recent.tracked,5);
  assert.equal(result.recent.hits,4);
  assert.equal(result.similar.tracked,6);
  assert.equal(result.similar.hits,5);
  assert.equal(result.upcomingDefenseRank,28);
  assert.ok(result.similarGames.every(g=>[2026,2025,2024].includes(g.season)));
  assert.ok(result.similarGames.every(g=>Math.abs(g.historicalRank-28)<=3));
  assert.equal(result.similarGames.some(g=>g.opponent==="Defense #24"),false);
  assert.equal(result.similarGames.some(g=>g.opponent==="Defense #32"),false);
  assert.ok(result.similarGames.every(g=>g.defenseReason.includes("ESPN passing defense")));
  assert.equal(result.recommendation,"OVER");
});
test("NFL UI shows defense ranks and clearly labels season aggregate look-ahead",()=>{
  const app=readFileSync(new URL("../public/app.js",import.meta.url),"utf8");
  // The production scanner must forward the chosen rank model. Otherwise the
  // analyzer silently uses the old incompatible defensive cohort algorithm
  // and displays zero verified NFL similar-defense games.
  assert.match(app,/matchupModel:input\.matchupModel/);
  assert.match(app,/historicalRank/);
  assert.match(app,/upcomingDefenseRank/);
  assert.match(app,/not necessarily pregame rankings/);
});
