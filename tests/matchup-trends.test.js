import test from "node:test";
import assert from "node:assert/strict";
import {CONFIG,matchupRole} from "../public/lib/auto-scan.js";
import {
  chooseIndependentLine,compareDefenses,buildMatchupCards,COMPARABLE_TOLERANCE
} from "../public/lib/matchup-trends.js";

const game={id:"123456789",sport:"nfl",date:"2026-10-08T19:00:00Z",season:2026};
const team={id:"1",name:"Current Team",targetOpponentId:"2"};
function fixture({
  sport="nfl",position="WR",stat="receivingYards",
  recent=[68,74,32,91,58],historic=[66,84,57,72],
  historicYears=[2025,2025,2024,2024],
  allowed=[105,95,100,103],target=100,
  targetGames=3
}={}){
  const first=CONFIG[sport].markets.find(m=>m[0]===stat);
  if(!first)throw Error("Missing configured market "+stat);
  const role=matchupRole(sport,position,stat);
  if(!role)throw Error("Missing configured role "+position);
  const key=stat+"|"+role.role;
  const profiles={"2":{target:{[key]:{
    average:target,games:targetGames,metricLabel:role.metricLabel
  }}}};
  const records=[];
  for(let i=0;i<recent.length;i++){
    const id="26-"+i,opp="n"+i,day=26-i;
    records.push({
      id,date:"2026-09-"+String(day).padStart(2,"0")+"T19:00:00Z",
      season:2026,opponent:"Recent Team "+i,opponentId:opp,
      players:[{id:"77",name:"Player",position,stats:{[stat]:recent[i]}}]
    });
    profiles[opp]={[id]:{[key]:{
      average:400,games:3,metricLabel:role.metricLabel
    }}};
  }
  for(let i=0;i<historic.length;i++){
    const id="old-"+i,opp="h"+i,year=historicYears[i]||2025;
    records.push({
      id,date:year+"-10-"+String(3+i).padStart(2,"0")+"T19:00:00Z",
      season:year,opponent:"Historical Defense "+i,opponentId:opp,
      playedTeamId:i===0?"9":"1",playedTeamName:i===0?"Former Club":"Current Team",
      players:[{id:"77",name:"Player",position,stats:{[stat]:historic[i]}}]
    });
    if(Number.isFinite(allowed[i])){
      profiles[opp]={[id]:{[key]:{
        average:allowed[i],games:3,metricLabel:role.metricLabel,
        rank:i===0?12:undefined
      }}};
    }
  }
  return {records,profiles,role};
}
function getOne(f,options={}){
  const result=buildMatchupCards(f.records,team,{
    ...game,sport:options.sport||game.sport
  },f.profiles,options);
  const p=result.find(p=>p.playerId==="77");
  assert.ok(p,"No player card generated");
  return p;
}

test("OVER line is derived solely from current-season recent games",()=>{
  const base=fixture();
  const before=getOne(base);
  assert.equal(before.line,67.5);
  const altered=fixture({historic:[1000,1000,1000,1000]});
  const after=getOne(altered);
  assert.equal(after.line,67.5);
  assert.equal(before.marketSource.includes("Research-only"),true);
  assert.equal(after.lineVerified,false);
});

test("recent 5 never borrows old-season games and displays actual 3/5 hit rate",()=>{
  const p=getOne(fixture());
  assert.equal(p.recentSample,5);
  assert.equal(p.recentHits,3);
  assert.equal(p.recentPct,60);
  assert.ok(p.history.every(g=>g.season===2026));
  assert.deepEqual(p.history.map(g=>g.value),[68,74,32,91,58]);
});

test("four most recent similar defenses produce actual 2/4, not forced 4/4",()=>{
  const p=getOne(fixture());
  assert.equal(p.similarSample,4);
  assert.equal(p.similarHits,2);
  assert.equal(p.similarPct,50);
  assert.deepEqual(p.similarGames.map(g=>g.season),[2025,2025,2024,2024]);
  assert.equal(p.similarGames.find(g=>g.gameId==="old-0").playedTeamId,"9");
  assert.equal(p.similarGames.find(g=>g.gameId==="old-0").opponentRanking,12);
  assert.match(p.similarGames[0].comparableReason,/within 25%/);
  assert.equal(p.line,67.5);
});

test("genuine 4/4 matches show observed 100% only when all four actually clear independent line",()=>{
  const p=getOne(fixture({historic:[79,84,80,95]}));
  assert.equal(p.similarHits,4);
  assert.equal(p.similarSample,4);
  assert.equal(p.similarPct,100);
  assert.equal(p.recentPct,60);
});

test("do not pad four matchups with unrelated defenses",()=>{
  const p=getOne(fixture({allowed:[105,500,100,500]}));
  assert.equal(p.similarSample,2);
  assert.deepEqual(p.similarGames.map(g=>g.opponent),["Historical Defense 0","Historical Defense 2"]);
  assert.match(p.sampleWarning,/Only 2 of four/);
});

test("missing historical defense averages never become valid matches",()=>{
  const p=getOne(fixture({allowed:[105,undefined,100,undefined]}));
  assert.equal(p.similarSample,2);
  assert.equal(p.notComparableCounts.profile>0,true);
});

test("historical comparator uses position-specific verified games, within 25%",()=>{
  const role=matchupRole("nfl","WR","receivingYards");
  const data=compareDefenses({
    sport:"nfl",stat:"receivingYards",role,
    target:{average:100,games:3,metricLabel:"WR receiving yards allowed/game"},
    historical:{average:120,games:3,metricLabel:"WR receiving yards allowed/game",rank:8}
  });
  assert.equal(data.comparable,true);
  assert.equal(data.deltaPct,20);
  assert.equal(data.ranking,8);
  assert.match(data.reason,/120\.0 vs upcoming 100\.0/);
  const bad=compareDefenses({
    sport:"nfl",stat:"receivingYards",role,
    target:{average:100,games:3},historical:{average:130,games:3}
  });
  assert.equal(bad.comparable,false);
  assert.equal(COMPARABLE_TOLERANCE,0.25);
});

test("under two historical defensive games cannot qualify",()=>{
  const p=getOne(fixture());
  const f=fixture();
  const old=f.profiles.h0["old-0"]["receivingYards|WR"];
  old.games=1;
  const limited=getOne(f);
  assert.equal(limited.similarSample,p.similarSample-1);
});

test("recent season with two games remains two; old career records do not fill it",()=>{
  const p=getOne(fixture({recent:[92,60]}));
  assert.equal(p.recentSample,2);
  assert.equal(p.history.length,2);
  assert.ok(p.similarGames.some(g=>g.season===2024));
  assert.match(p.sampleWarning,/fewer than three recorded games/);
});

test("position changes block old games from the wrong role",()=>{
  const f=fixture();
  f.records.find(g=>g.id==="old-1").players[0].position="TE";
  const p=getOne(f);
  assert.equal(p.similarSample,3);
  assert.equal(p.similarGames.some(g=>g.gameId==="old-1"),false);
});

test("a quoted sportsbook line is used only with explicit verification and timestamp",()=>{
  const recent=[{value:68},{value:74},{value:32}];
  const accepted=chooseIndependentLine(recent,10,{
    line:49.5,source:"PrizePicks",quotedAt:"2026-10-08T13:00:00Z",verified:true
  });
  assert.equal(accepted.line,49.5);
  assert.equal(accepted.verified,true);
  const rejected=chooseIndependentLine(recent,10,{
    line:0.5,source:"PrizePicks",quotedAt:"",verified:true
  });
  assert.notEqual(rejected.line,0.5);
  assert.equal(rejected.verified,false);
});

test("without real lines the app never labels an alt threshold as PrizePicks",()=>{
  const p=getOne(fixture());
  assert.equal(p.sourceMarketLine,false);
  assert.equal(p.lineVerified,false);
  assert.match(p.marketSource,/not a live PrizePicks/);
});

test("soccer comparisons reject known opponents from a different league",()=>{
  const role=matchupRole("soccer","FW","shots");
  const match=compareDefenses({sport:"soccer",stat:"shots",role,
    target:{average:10,games:5},historical:{average:10,games:5},
    historicalLeague:"esp.1",currentLeague:"eng.1"});
  assert.equal(match.comparable,false);
});

test("MLB hitters require verified starter handedness, not team staff proxy alone",()=>{
  const role=matchupRole("mlb","DH","hits");
  assert.ok(role);
  const args={sport:"mlb",stat:"hits",role,
    target:{average:8,games:3},historical:{average:9,games:3}};
  assert.equal(compareDefenses(args).comparable,false);
  assert.match(compareDefenses(args).reason,/starter handedness/);
  assert.equal(compareDefenses({
    ...args,target:{...args.target,pitcherHand:"R"},
    historical:{...args.historical,pitcherHand:"L"}
  }).comparable,false);
  assert.equal(compareDefenses({
    ...args,target:{...args.target,pitcherHand:"R"},
    historical:{...args.historical,pitcherHand:"R"}
  }).comparable,true);
});

test("MLB pitching strikeout comparisons use the lineup role rather than pitcher handedness",()=>{
  const role=matchupRole("mlb","SP","pitcherKs");
  assert.equal(role.role,"LINEUP");
  assert.equal(compareDefenses({
    sport:"mlb",stat:"pitcherKs",role,
    target:{average:9,games:3},historical:{average:10,games:3}
  }).comparable,true);
  assert.equal(matchupRole("mlb","SP","hits"),null);
  assert.equal(matchupRole("mlb","DH","pitcherKs"),null);
});

test("model covers all six sports with accurate stat-position role labels",()=>{
  const cases=[
    ["nfl","WR","receivingYards"],
    ["nba","PG","assists"],
    ["ncaaf","RB","rushingYards"],
    ["ncaab","C","rebounds"],
    ["soccer","FW","shots"],
    ["mlb","SP","pitcherKs"]
  ];
  for(const [sport,position,stat] of cases){
    const f=fixture({sport,position,stat,
      recent:[14,18,10,20,11],historic:[13,16,18,12],target:10,
      allowed:[11,9,10,12]});
    const p=getOne(f,{sport});
    assert.equal(p.stat,stat);
    assert.equal(p.recentSample,5);
    assert.equal(p.similarSample,4,sport);
    assert.ok(p.similarGames.every(g=>g.metricLabel.includes(CONFIG[sport].markets.find(m=>m[0]===stat)[1].toLowerCase())
      ||g.metricLabel.includes("Opposing lineup")));
  }
});

test("optional actual pace or efficiency can reject noncomparable opponents",()=>{
  const role=matchupRole("nba","PG","assists");
  const target={average:6,games:4,pace:101};
  const fast={average:6,games:4,pace:102};
  const slow={average:6,games:4,pace:70};
  assert.equal(compareDefenses({sport:"nba",stat:"assists",role,target,historical:fast}).comparable,true);
  assert.equal(compareDefenses({sport:"nba",stat:"assists",role,target,historical:slow}).comparable,false);
  assert.deepEqual(compareDefenses({sport:"nba",stat:"assists",role,target,historical:fast}).verifiedExtras,["pace"]);
});
