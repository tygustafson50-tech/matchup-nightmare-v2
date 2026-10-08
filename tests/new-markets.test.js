import test from "node:test";
import assert from "node:assert/strict";
import {CONFIG,extractBoxscore,matchupRole,positionAllowedByGame} from "../lib/auto-scan.js";

function event(sport,position,category,labels,stats){
  return {boxscore:{players:[
    {team:{id:"1"},statistics:[{name:category,labels,athletes:[
      {athlete:{id:"77",displayName:"Real game player",
        position:{abbreviation:position}},stats:stats.map(String)}
    ]}]},
    {team:{id:"2"},statistics:[]}
  ]}};
}
test("NFL and college passing/rushing/receiving touchdowns are extracted by category",()=>{
  for(const sport of ["nfl","ncaaf"]){
    const pass=extractBoxscore(event(sport,"QB","passing",
      ["YDS","C/ATT","TD"],[265,"21/32",3]),sport,"1")[0];
    assert.equal(pass.stats.passingYards,265);
    assert.equal(pass.stats.passAttempts,32);
    assert.equal(pass.stats.passCompletions,21);
    assert.equal(pass.stats.passingTDs,3);
    const rush=extractBoxscore(event(sport,"RB","rushing",
      ["CAR","YDS","TD"],[14,88,2]),sport,"1")[0];
    assert.equal(rush.stats.rushingTDs,2);
    const rec=extractBoxscore(event(sport,"WR","receiving",
      ["REC","YDS","TD","TGTS"],[6,93,1,8]),sport,"1")[0];
    assert.equal(rec.stats.receivingTDs,1);
    assert.equal(rec.stats.targets,8);
  }
});

test("MLB batting home runs and total bases require genuine box score components",()=>{
  const b=extractBoxscore(event("mlb","DH","batting",
    ["H","2B","3B","HR","RBI"],[3,1,0,1,2]),"mlb","1")[0];
  assert.equal(b.stats.hits,3);
  assert.equal(b.stats.homeRuns,1);
  assert.equal(b.stats.totalBases,7);
});

test("pitching outs converts baseball notation innings and avoids decimal arithmetic",()=>{
  const p=extractBoxscore(event("mlb","SP","pitching",["IP","K"],["6.2",8]),"mlb","1")[0];
  assert.equal(p.stats.pitchingOuts,20);
  assert.equal(p.stats.pitcherKs,8);
  assert.equal(extractBoxscore(event("mlb","SP","pitching",
    ["IP"],["5.3"]),"mlb","1")[0]?.stats.pitchingOuts,undefined);
});

test("pitching outs are never used as a fake lineup stat allowed to opponents",()=>{
  const game=event("mlb","SP","pitching",["IP","K"],["5.2",6]);
  const defensive=positionAllowedByGame(game,"mlb","2");
  assert.equal(defensive["pitchingOuts|LINEUP"],undefined);
});

test("NBA and men's college basketball stat combinations are formed only from verified inputs",()=>{
  for(const sport of ["nba","ncaab"]){
    const player=extractBoxscore(event(sport,"PG","starters",
      ["PTS","REB","AST","3PT"],[20,6,7,"3-8"]),sport,"1")[0];
    assert.equal(player.stats.pra,33);
    assert.equal(player.stats.threes,3);
  }
});

test("soccer tackles and fouls parse only if those stat labels are present",()=>{
  const d=extractBoxscore(event("soccer","DF","players",
    ["SH","SOT","TACK","FC"],[1,0,3,2]),"soccer","1")[0];
  assert.equal(d.stats.tackles,3);
  assert.equal(d.stats.fouls,2);
  assert.equal(d.stats.shots,1);
});

test("supported sport market menus include new stats without inventing missing results",()=>{
  const required={
    nfl:["passingTDs","rushingTDs","receivingTDs","targets"],
    nba:["threes","pra"],
    ncaaf:["passAttempts","passingTDs","rushingTDs","receivingTDs"],
    ncaab:["threes","pra"],
    mlb:["homeRuns","pitcherKs","pitchingOuts"],
    soccer:["tackles","fouls","shotsOnTarget"]
  };
  for(const [sport,stats] of Object.entries(required)){
    for(const stat of stats){
      assert.ok(CONFIG[sport].markets.some(m=>m[0]===stat),sport+" missing "+stat);
    }
  }
  const sparse=extractBoxscore(event("nfl","WR","receiving",
    ["REC"],[4]),"nfl","1")[0];
  assert.equal(sparse.stats.receivingYards,undefined);
  assert.equal(sparse.stats.receivingTDs,undefined);
});
