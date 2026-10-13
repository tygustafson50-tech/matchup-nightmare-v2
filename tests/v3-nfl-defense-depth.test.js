import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {analyzeVerifiedProp} from "../public/lib/research-v3.js";
import {strictDefenseGate,strictDefenseComparison,readDefenseGameContext,
  buildDefenseContext,chooseStrictSimilarGames,
  NFL_SIMILAR_MIN,NFL_SIMILAR_MAX,NFL_PRIMARY_RANK_BAND}
  from "../public/lib/nfl-defense-depth.js";
const defense=(id,year,pass=28,rush=10,passYpg=220,rushYpg=105)=>({
  teamId:String(id),season:year,verified:true,
  passing:{rank:pass,yardsPerGame:passYpg},
  rushing:{rank:rush,yardsPerGame:rushYpg}
});
const ctx=(roleAllowed,rbReceptionsAllowed=4)=>({
  verifiedGames:4,roleAllowed,rbCatchesGames:4,
  rbReceptionsAllowed,rbTargetsGames:4,rbTargetsAllowed:6
});
test("NFL rank gates require BOTH passing and running rankings and yardage",()=>{
  const target=defense(1,2026,28,10),good=defense(2,2025,26,16,238,117);
  assert.equal(strictDefenseGate(target,good,"receivingYards").ok,true);
  assert.equal(strictDefenseGate(target,defense(3,2025,22,14,280,105),"receivingYards").ok,false);
  assert.equal(strictDefenseGate(target,defense(4,2025,27,31,220,180),"receivingYards").ok,false);
  assert.equal(strictDefenseGate(target,defense(5,2025,20,12,400,100),"receivingYards").ok,false);
  assert.equal(NFL_PRIMARY_RANK_BAND,5);
});
test("RB receptions against defense are a checkdown PROXY, never actual tracked checkdowns",()=>{
  const target=defense(1,2026),historical=defense(2,2025,27,13,224,108);
  const common={target,historical,role:"RB",stat:"receptions",
    targetContext:ctx(5,4),historicalContext:ctx(5.7,4.7)};
  const result=strictDefenseComparison(common);
  assert.equal(result.ok,true);
  assert.equal(result.checkdownProxyVerified,true);
  assert.match(result.context,/CHECKDOWN PROXY only/);
  assert.equal(strictDefenseComparison({...common,
    historicalContext:ctx(5.7,8)}).ok,false);
  assert.equal(strictDefenseComparison({...common,
    historicalContext:{...ctx(5.7,4.7),rbCatchesGames:1}}).ok,false);
});
test("missing or different WR position stats never pad strict matches",()=>{
  const target=defense(1,2026),historical=defense(2,2025,27,13,224,108);
  const common={target,historical,role:"WR",stat:"receivingYards",targetContext:ctx(160)};
  assert.equal(strictDefenseComparison({...common,historicalContext:ctx(260)}).ok,false);
  assert.equal(strictDefenseComparison({...common,
    historicalContext:{...ctx(175),verifiedGames:2}}).ok,false);
});
const summary={boxscore:{players:[
  {team:{id:"9"},statistics:[{name:"receiving",labels:["REC","YDS","TGTS"],
    athletes:[
      {athlete:{id:"101",displayName:"Actual RB",position:{abbreviation:"RB"}},
        stats:["6","41","8"]},
      {athlete:{id:"102",displayName:"Actual WR",position:{abbreviation:"WR"}},
        stats:["7","91","11"]}
    ]}]},
  {team:{id:"1"},statistics:[]}
]}};
test("ESPN RB catches and WR yardage reflect ACTUAL opponent boxscores",()=>{
  assert.deepEqual(readDefenseGameContext(summary,"1","RB","receptions"),
    {value:6,rbCatches:6,rbTargets:8});
  assert.deepEqual(readDefenseGameContext(summary,"1","WR","receivingYards"),
    {value:91,rbCatches:6,rbTargets:8});
  assert.equal(readDefenseGameContext({boxscore:{players:[]}},"1","RB","receptions").value,null);
});
test("only box scores BEFORE kickoff build the role-allowance profile",async()=>{
  const cutoff="2026-10-20T19:00:00Z";
  const event=(id,date)=>({id,date,season:{year:2026},
    status:{type:{completed:true}},competitions:[{
      competitors:[{team:{id:"1"}},{team:{id:"2"}}]
    }]});
  const schedule=async()=>({events:[
    event("100001","2026-10-05T18:00:00Z"),
    event("100002","2026-10-12T18:00:00Z"),
    event("100003","2026-10-19T18:00:00Z"),
    event("100004","2026-10-25T18:00:00Z")]});
  const actual={boxscore:{players:[
    {team:{id:"1"},statistics:[]},
    {team:{id:"2"},statistics:[{name:"receiving",labels:["REC","YDS","TGTS"],
      athletes:[{athlete:{id:"91",displayName:"RB",position:{abbreviation:"RB"}},
        stats:["5","22","6"]}]}]}
  ]}};
  const result=await buildDefenseContext({teamId:"1",season:2026,cutoff,
    role:"RB",stat:"receptions",schedule,summary:async()=>actual});
  assert.equal(result.verifiedGames,3);
  assert.equal(result.roleAllowed,5);
  assert.equal(result.rbReceptionsAllowed,5);
});
test("select six best defensive fits without looking at prop OVERS",()=>{
  const rows=Array.from({length:9},(_,i)=>({
    id:String(i),date:"2025-09-"+String(i+1).padStart(2,"0")+"T20:00:00Z",
    similarity:90-i,actual:i%2===0?0:200,rankDifference:i%3
  }));
  assert.deepEqual(chooseStrictSimilarGames(rows).map(x=>x.id),
    ["0","1","2","3","4","5"]);
  assert.equal(NFL_SIMILAR_MIN,3);
  assert.equal(NFL_SIMILAR_MAX,6);
});
const offer={id:"real-quote",source:"PropLine",sport:"nfl",status:"active",
  player:"Example Back",position:"RB",espnPlayerId:"42",team:"A",opponent:"B",
  book:"DraftKings",bookKey:"draftkings",stat:"receptions",market:"Receptions",
  line:3.5,variant:"standard",quotedAt:"2026-10-12T19:00:00Z",
  gameDateLocal:"2026-10-13"};
function analyzed(matches){
  const up=defense(99,2026,25,15,223,117),target=ctx(4.8,4.8);
  const games=[],profiles=[];
  for(let i=0;i<8;i++){
    const year=i<5?2026:i<7?2025:2024;
    const id="match"+i;
    games.push({id,date:year+"-09-"+String(i+2).padStart(2,"0")+"T20:00:00Z",
      season:year,stat:"receptions",sport:"nfl",playerId:"42",
      opponentId:String(i+10),actual:i%5===0?2:6,opponent:"Example "+i,
      team:"A",source:"ESPN game summary",verified:true});
    // Nonqualifiers differ BOTH by >5 ranks and >10% pass yardage.
    profiles.push({...defense(i+10,year,i<matches?25+i%3:15,17,
      i<matches?226:300,119),
      gameId:id,context:ctx(5,5)});
  }
  return analyzeVerifiedProp({offer,season:2026,games,
    upcomingDefense:up,upcomingContext:target,defensiveProfiles:profiles,
    matchupModel:"nfl-depth",now:"2026-10-12T20:00:00Z"});
}
test("0–2 matches never qualify for OVER or an invented 100% sample",()=>{
  for(const count of [0,1,2]){
    const result=analyzed(count);
    assert.equal(result.similar.tracked,count);
    assert.equal(result.evidenceSufficient,false);
    assert.equal(result.recommendation,null);
    assert.match(result.limitations.join(" "),/needed for a supported OVER/);
  }
});
test("3–6 confirmed defenses can support OVER but never more than six",()=>{
  const three=analyzed(3);
  assert.equal(three.similar.tracked,3);
  assert.equal(three.recommendation,"OVER");
  const all=analyzed(8);
  assert.equal(all.similar.tracked,6);
  assert.equal(all.matchupSampleTarget.min,3);
  assert.equal(all.matchupSampleTarget.max,6);
  assert.ok(all.similarGames.every(x=>x.contextGames>=3));
  assert.match(all.defenseMatchMethod,/Strict NFL/);
});
test("visible NFL cards identify metric as proxy, not measured checkdowns",()=>{
  const app=readFileSync(new URL("../public/app.js",import.meta.url),"utf8");
  assert.match(app,/upcomingContext:input\.upcomingContext/);
  assert.match(app,/checkdown proxy, not tracked checkdown throws/);
  assert.match(app,/Distinct similar defenses \(3–6 target\)/);
});
