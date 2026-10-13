import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {positionGroup,supportsMarket,analyzeVerifiedProp}
  from "../public/lib/research-v3.js";
import {concededAgainstPosition}
  from "../public/lib/evidence-client-v3.js";
import {DEEP_STAT_DIMENSIONS,deepStatSpec,makeDeepProfile,
  compareDeepDefense,chooseDeepGames,STRICT_MIN_MATCHES,STRICT_MAX_MATCHES}
  from "../public/lib/sport-defense-depth.js";

const roles={
  ncaaf:["QB","RB","WR","TE"],
  nba:["PG","SG","SF","PF","C","G","F"],
  ncaab:["G","F","C"],
  mlb:["BATTER","P"],
  soccer:["F","M","D","GK"]
};
const actualPositions={
  ncaaf:{QB:"QB",RB:"RB",WR:"WR",TE:"TE"},
  nba:{PG:"PG",SG:"SG",SF:"SF",PF:"PF",C:"C",G:"G",F:"F"},
  ncaab:{G:"G",F:"F",C:"C"},
  mlb:{BATTER:"DH",P:"SP"},
  soccer:{F:"F",M:"M",D:"D",GK:"G"}
};
test("all actual supported non-NFL roles and stats have stat-aware configurations",()=>{
  assert.equal(STRICT_MIN_MATCHES,4);
  assert.equal(STRICT_MAX_MATCHES,6);
  for(const [sport,choices] of Object.entries(roles)){
    for(const role of choices){
      for(const stat of Object.keys(DEEP_STAT_DIMENSIONS[sport])){
        const actual=actualPositions[sport][role];
        if(!supportsMarket(sport,actual,stat))continue;
        const parsed=positionGroup(sport,actual);
        if(sport==="mlb"&&((role==="P")!==["pitcherKs","pitchingOuts"].includes(stat)))continue;
        if(sport==="soccer"&&((parsed==="GK")!==(stat==="saves")))continue;
        const spec=deepStatSpec(sport,stat,parsed);
        assert.ok(spec,sport+" "+role+" "+stat+" missing");
        assert.ok(spec.secondary.length,sport+" "+role+" "+stat+" missing 2nd dimension");
        assert.equal(spec.stat,stat);
      }
    }
  }
});
function profile(sport,role,stat,gameId,allowed=18,volume=11,year=2026,
  supportValue=5,league=null){
  const spec=deepStatSpec(sport,stat,role);
  const secondaryStats=Object.fromEntries(spec.secondary.map(k=>[k,supportValue]));
  const secondaryGames=Object.fromEntries(spec.secondary.map(k=>[k,4]));
  return makeDeepProfile({sport,role,stat,gameId,teamId:"100",
    season:year,asOf:year+"-09-01T19:00:00Z",
    metrics:{allowed,volume},verifiedGames:4,
    secondaryStats,secondaryGames,league});
}
test("independent stat + volume + companion comparisons reject weak similarities",()=>{
  for(const [sport,role,stat,league] of [
    ["ncaaf","WR","receivingYards",null],
    ["nba","PG","assists",null],
    ["ncaab","G","rebounds",null],
    ["mlb","BATTER","hits",null],
    ["mlb","P","pitcherKs",null],
    ["mlb","P","pitchingOuts",null],
    ["soccer","F","shots", "eng.1"],
    ["soccer","GK","saves","eng.1"]
  ]){
    const current=profile(sport,role,stat,null,20,13,2026,5,league);
    const similar=profile(sport,role,stat,"old",22,14,2025,5.7,league);
    const args={sport,role,stat,league};
    const found=compareDeepDefense(current,similar,args);
    assert.equal(found.ok,true,sport+" "+role+" "+stat+" "+found.reason);
    assert.match(found.context,/3\+ prior games/);
    assert.ok(found.companion.length>0);
    assert.equal(compareDeepDefense(current,profile(sport,role,stat,
      "weak",35,14,2025,5.7,league),args).ok,false);
    assert.equal(compareDeepDefense(current,profile(sport,role,stat,
      "opportunities",22,27,2025,5.7,league),args).ok,false);
    assert.equal(compareDeepDefense(current,profile(sport,role,stat,
      "companions",22,14,2025,12,league),args).ok,false);
    const missing=profile(sport,role,stat,"missing",22,14,2025,5.7,league);
    missing.secondary={};
    assert.equal(compareDeepDefense(current,missing,args).ok,false);
    missing.verifiedGames=2;
    assert.equal(compareDeepDefense(current,missing,args).ok,false);
  }
});
test("soccer comparisons never leak across different leagues",()=>{
  const t=profile("soccer","F","shots",null,11,9,2026,4,"eng.1");
  const h=profile("soccer","F","shots","a",11,9,2025,4,"esp.1");
  assert.equal(compareDeepDefense(t,h,{sport:"soccer",stat:"shots",
    role:"F",league:"eng.1"}).ok,false);
});
test("highest defense fit selects six, never strongest OVER hits",()=>{
  const rows=Array.from({length:9},(_,i)=>({
    id:String(i),date:"2025-09-"+String(i+1).padStart(2,"0")+"T12:00:00Z",
    similarity:96-i,actual:i%2?5:0,rankDifference:i%3
  }));
  assert.deepEqual(chooseDeepGames(rows).map(x=>x.id),
    ["0","1","2","3","4","5"]);
});
test("verified MLB pitcher K opportunity uses batting team strikeouts, not opponent pitcher staff",()=>{
  const summary={boxscore:{players:[
    {team:{id:"1"},statistics:[{labels:["AB","H","BB","K"],
      athletes:[{athlete:{id:"11",displayName:"Batter One",
        position:{abbreviation:"DH"}},stats:["4","2","1","3"]}]}]},
    {team:{id:"2"},statistics:[{labels:["AB","H","BB","K"],
      athletes:[{athlete:{id:"22",displayName:"Other Batter",
        position:{abbreviation:"DH"}},stats:["3","1","0","0"]}]}]}
  ]}};
  const k=concededAgainstPosition(summary,{sport:"mlb",
    defenseId:"1",role:"P",stat:"pitcherKs"});
  assert.deepEqual(k,{allowed:3,volume:4,volumeSource:"atBats",
    statSource:"battingStrikeouts"});
  const outs=concededAgainstPosition(summary,{sport:"mlb",
    defenseId:"1",role:"P",stat:"pitchingOuts"});
  assert.equal(outs.allowed,4);
  assert.equal(outs.statSource,"atBats");
});
test("ESPN soccer GK save opportunity uses the opponent's shots-on-target, not other team defense",()=>{
  const fwd=(id,name,shots,sot)=>({
    athlete:{id,displayName:name},position:{abbreviation:"F"},
    stats:[{name:"totalShots",value:shots},{name:"shotsOnTarget",value:sot}]
  });
  const soccer={rosters:[
    {team:{id:"1"},roster:[fwd("11","Home Forward",7,4)]},
    {team:{id:"2"},roster:[fwd("22","Away Forward",2,1)]}
  ]};
  const saves=concededAgainstPosition(soccer,{sport:"soccer",
    defenseId:"1",role:"GK",stat:"saves"});
  assert.equal(saves.allowed,4);
  assert.equal(saves.volume,7);
  assert.equal(saves.statSource,"shotsOnTarget");
});
function offerFor(sport,stat,position){
  return {id:"real-source-prop",source:"PropLine",status:"active",
    sport,player:"Example Player",position,team:"A",opponent:"B",
    book:"DraftKings",bookKey:"draftkings",line:3.5,stat,
    market:stat,quotedAt:"2026-10-12T18:00:00Z",
    gameDateLocal:"2026-10-13",espnPlayerId:"800",
    league:sport==="soccer"?"eng.1":null,variant:"standard"};
}
function analyze(sport,stat,position,role,numMatches){
  const upcoming=profile(sport,role,stat,null,20,10,2026,5,
    sport==="soccer"?"eng.1":null);
  const games=[],hist=[];
  for(let i=0;i<9;i++){
    const year=i<5?2026:i<7?2025:2024;
    const id="ex"+i;
    games.push({id,stat,sport,playerId:"800",
      season:year,actual:6,
      date:year+"-09-"+String(i+1).padStart(2,"0")+"T19:00:00Z",
      opponent:"Actual "+i,opponentId:String(i+100),
      source:"ESPN game summary",verified:true});
    hist.push({...profile(sport,role,stat,id,i<numMatches?21:50,
      10,year,5.1,sport==="soccer"?"eng.1":null),
      teamId:String(i+100)});
  }
  return analyzeVerifiedProp({offer:offerFor(sport,stat,position),
    season:2026,games,upcomingDefense:upcoming,
    defensiveProfiles:hist,
    matchupModel:"multi-sport-depth",now:"2026-10-12T19:00:00Z"});
}
test("all sports enforce 4–6 sampled verified matches with no 100% padding",()=>{
  for(const [sport,stat,position,role] of [
    ["ncaaf","passingYards","QB","QB"],
    ["nba","points","PG","PG"],
    ["ncaab","assists","G","G"],
    ["mlb","hits","DH","BATTER"],
    ["mlb","pitcherKs","SP","P"],
    ["soccer","shots","F","F"],
    ["soccer","saves","G","GK"]
  ]){
    const three=analyze(sport,stat,position,role,3);
    assert.equal(three.similar.tracked,3,sport);
    assert.equal(three.recommendation,null,sport);
    assert.equal(three.evidenceSufficient,false,sport);
    assert.match(three.limitations.join(" "),/No OVER recommendation/);
    const all=analyze(sport,stat,position,role,9);
    assert.equal(all.similar.tracked,6,sport);
    assert.equal(all.matchupSampleTarget.min,4);
    assert.equal(all.matchupSampleTarget.max,6);
    assert.equal(all.recommendation,"OVER",sport);
    assert.ok(all.similarGames.every(g=>g.supportingStats.length>0),sport);
  }
});
test("production forwards the verified deep sport model and shows the actual metrics",()=>{
  const app=readFileSync(new URL("../public/app.js",import.meta.url),"utf8");
  const client=readFileSync(new URL("../public/lib/evidence-client-v3.js",
    import.meta.url),"utf8");
  assert.match(app,/matchupModel:input\.matchupModel/);
  assert.match(app,/supportingStatNames/);
  assert.match(client,/matchupModel:"multi-sport-depth"/);
  assert.match(client,/positionGroup\(sport,player\.position\)/);
});
