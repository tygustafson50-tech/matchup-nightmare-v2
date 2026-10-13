import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {normalizePropLineOdds} from "../functions/api/lines.js";

const NOW=Date.now(),DATE="2026-10-11";
function quote(sport,key,outcome,opts={}){
  const stamp=new Date(NOW-(opts.minutesAgo||0)*60000).toISOString();
  const record={
    id:"777",home_team:"Real Home",away_team:"Real Away",
    commence_time:"2026-10-12T00:20:00Z",
    bookmakers:[{key:"draftkings",title:"DraftKings",markets:[{
      key,last_update:stamp,suspended_at:opts.suspended?stamp:null,
      outcomes:[{description:"Verified Athlete",price:-120,...outcome,
        ...(opts.lastSeenMinutesAgo!=null?{
          last_seen_at:new Date(NOW-opts.lastSeenMinutesAgo*60000).toISOString()
        }:{})}]
    }]}]
  };
  return normalizePropLineOdds([record],{sport,date:DATE,now:NOW});
}
test("every sport accepts a real priced Over selection",()=>{
  const all=[
    ["nfl","player_receptions",4.5],
    ["ncaaf","player_pass_yds",195.5],
    ["nba","player_points",22.5],
    ["ncaab","player_rebounds",6.5],
    ["mlb","batter_hits",0.5],
    ["soccer","player_assists",0.5]
  ];
  for(const [sport,key,point] of all){
    const x=quote(sport,key,{name:"Over",point});
    assert.equal(x.length,1,sport+" should retain the sportsbook quote");
    assert.equal(x[0].line,point);
    assert.equal(x[0].price,-120);
  }
});
test("priced yes-only soccer player assists and goals are exact integer milestones",()=>{
  for(const key of ["player_assists","anytime_goal_scorer"]){
    const x=quote("soccer",key,{name:"Yes",point:null});
    assert.equal(x.length,1,key);
    assert.equal(x[0].line,0.5);
    assert.equal(x[0].minimumStat,1);
    assert.equal(x[0].quoteShape,"milestone");
  }
});
test("soccer 2+ tackles and 2+ goals reflect real DraftKings milestone odds",()=>{
  const a=quote("soccer","player_tackles",{name:"2+ Tackles",point:null});
  assert.equal(a.length,1);
  assert.equal(a[0].selectionLabel,"2+ Tackles");
  assert.equal(a[0].line,1.5);
  const b=quote("soccer","2plus_goals",{name:"Verified Athlete",point:null});
  assert.equal(b.length,1);
  assert.equal(b[0].minimumStat,2);
  assert.equal(b[0].line,1.5);
});
test("MLB yes-only runs and milestone hits do not disappear",()=>{
  const a=quote("mlb","batter_runs",{name:"Verified Athlete",point:null});
  const b=quote("mlb","batter_3plus_hits",{name:"Yes",point:null});
  assert.equal(a.length,1);
  assert.equal(a[0].line,0.5);
  assert.equal(b.length,1);
  assert.equal(b[0].line,2.5);
});
test("never retain unpriced, under, suspended, withdrawn, or >90-minute quotes",()=>{
  assert.equal(quote("nba","player_points",{name:"Under",point:20.5}).length,0);
  assert.equal(quote("nba","player_points",{name:"Over",point:20.5,price:null}).length,0);
  assert.equal(quote("nba","player_points",{name:"Over",point:20.5},{suspended:true}).length,0);
  assert.equal(quote("nba","player_points",{name:"Over",point:20.5},{minutesAgo:120}).length,0);
  assert.equal(quote("nba","player_points",{name:"Over",point:20.5},
    {lastSeenMinutesAgo:12}).length,0);
  assert.equal(quote("nba","player_points",{name:"Over",point:20.5},
    {minutesAgo:50}).length,1);
});
test("real ESPN fixtures match bookmaker names without inventing associations",()=>{
  const source=readFileSync(new URL("../public/app.js",import.meta.url),"utf8");
  const start=source.indexOf("function fixtureMatches(");
  const end=source.indexOf("\nasync function scan()",start);
  assert.ok(start>0&&end>start);
  const matches=new Function(source.slice(start,end)+"\nreturn fixtureMatches;")();
  const game=(id,home,away)=>({id,home:{name:home},away:{name:away}});
  assert.equal(matches({sport:"nba",fixture:{
    home:"LA Clippers",away:"New York Knicks"}},
    game("401111111","Los Angeles Clippers","New York Knicks")),true);
  assert.equal(matches({sport:"ncaaf",fixture:{
    home:"Michigan St Spartans",away:"Ohio State Buckeyes"}},
    game("401111112","Michigan State Spartans","Ohio State Buckeyes")),true);
  assert.equal(matches({sport:"soccer",fixture:{
    home:"Man Utd",away:"Liverpool"}},
    game("401111113","Manchester United","Liverpool")),true);
  assert.equal(matches({sport:"soccer",fixture:{
    home:"Man Utd",away:"Liverpool"}},
    game("401111114","Manchester City","Liverpool")),false);
});
