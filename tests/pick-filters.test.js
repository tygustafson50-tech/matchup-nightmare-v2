import test from "node:test";
import assert from "node:assert/strict";
import {
  FIXED_SCAN,INITIAL_FILTERS,getPickOptions,filterPickCards
} from "../public/lib/pick-filters.js";

function pick({
  player="Player One",sport="nfl",team="Dallas Cowboys",teamId="1",
  market="Passing yards",position="QB",trend="recent",sample=5
}={}){
  return {
    player,sport,teamName:team,teamId,market,position,
    scanMode:trend,sample,line:49.5,
    recentSample:5,recentHits:5,similarGames:[]
  };
}

test("the one-click OVER scan remains both trends across three seasons",()=>{
  assert.deepEqual(FIXED_SCAN,{mode:"both",window:3,overOnly:true});
  assert.ok(Object.isFrozen(FIXED_SCAN));
});

test("only three user filter fields exist",()=>{
  assert.deepEqual(Object.keys(INITIAL_FILTERS).sort(),["market","position","team"]);
  assert.deepEqual(INITIAL_FILTERS,{market:"all",team:"all",position:"all"});
});

test("every supported sport uses the same three fields",()=>{
  const sports=["nfl","nba","mlb","ncaaf","ncaab","soccer"];
  const markets=["Passing yards","Points","Hits","Receiving yards","Rebounds","Shots on target"];
  const original=sports.map((sport,i)=>pick({
    sport,teamId:String(i+1),team:"Team "+i,market:markets[i],position:["QB","PG","DH","WR","C","FW"][i]
  }));
  assert.equal(filterPickCards(original).length,6);
  assert.equal(getPickOptions(original).markets.length,6);
  assert.equal(getPickOptions(original).teams.length,6);
  assert.equal(getPickOptions(original).positions.length,6);
});

test("stat only filters one prop without requiring a different scan",()=>{
  const all=[pick({market:"Passing yards"}),pick({market:"Receiving yards"})];
  assert.deepEqual(filterPickCards(all,{market:"Receiving yards"}).map(p=>p.market),["Receiving yards"]);
});

test("team filter uses team ID, not ambiguous short names",()=>{
  const all=[pick({team:"United",teamId:"1",player:"One"}),
    pick({team:"United",teamId:"2",player:"Two"})];
  assert.deepEqual(filterPickCards(all,{team:"2"}).map(p=>p.player),["Two"]);
});

test("position filters are specific to selected sport",()=>{
  const all=[pick({position:"QB"}),pick({position:"WR"}),pick({position:"RB"})];
  assert.deepEqual(filterPickCards(all,{position:"RB"}).map(p=>p.position),["RB"]);
});

test("all three filters work together",()=>{
  const all=[
    pick({market:"Receiving yards",teamId:"1",position:"WR",player:"Yes"}),
    pick({market:"Receiving yards",teamId:"1",position:"TE",player:"Wrong position"}),
    pick({market:"Receptions",teamId:"1",position:"WR",player:"Wrong stat"}),
    pick({market:"Receiving yards",teamId:"2",position:"WR",player:"Wrong team"})
  ];
  assert.deepEqual(filterPickCards(all,{
    market:"Receiving yards",team:"1",position:"WR"
  }).map(p=>p.player),["Yes"]);
});

test("All selections return all pick cards",()=>{
  const all=[pick({player:"One"}),pick({player:"Two"})];
  assert.equal(filterPickCards(all,{market:"all",team:"all",position:"all"}).length,2);
  assert.equal(filterPickCards(all).length,2);
});

test("dropdown values come from returned cards, not guessed league markets",()=>{
  const all=[
    pick({team:"Lions",teamId:"1",market:"Rushing yards",position:"RB"}),
    pick({team:"Bears",teamId:"2",market:"Receiving yards",position:"TE"}),
    pick({team:"Lions",teamId:"1",market:"Receiving yards",position:"WR"})
  ];
  const values=getPickOptions(all);
  assert.deepEqual(values.markets,["Receiving yards","Rushing yards"]);
  assert.deepEqual(values.positions,["RB","TE","WR"]);
  assert.equal(values.teams.length,2);
  assert.deepEqual(Object.keys(values).sort(),["markets","positions","teams"]);
});

test("filters run on entire list before 24-card pagination",()=>{
  const all=Array.from({length:160},(_,i)=>pick({
    player:"Athlete "+i,teamId:i===129?"99":"1",
    market:i===129?"Goals":"Points",position:i===129?"FW":"PG"
  }));
  const found=filterPickCards(all,{market:"Goals",team:"99",position:"FW"});
  assert.equal(found.length,1);
  assert.equal(found[0].player,"Athlete 129");
});

test("missing values and zero-match filters remain safe",()=>{
  assert.deepEqual(filterPickCards([]),[]);
  assert.deepEqual(filterPickCards(null),[]);
  assert.deepEqual(filterPickCards([pick()],{position:"C"}),[]);
  assert.deepEqual(getPickOptions([]),{markets:[],teams:[],positions:[]});
});

test("filtering does not mutate source cards or rewrite scan calculations",()=>{
  const all=[pick({player:"A",trend:"similar",sample:4}),
    pick({player:"B",trend:"recent",sample:5})];
  const before=JSON.stringify(all);
  filterPickCards(all,{team:"1",market:"Passing yards"});
  assert.equal(JSON.stringify(all),before);
});
