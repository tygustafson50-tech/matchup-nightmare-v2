import test from "node:test";
import assert from "node:assert/strict";
import {FIXED_SCAN,INITIAL_FILTERS,getPickOptions,filterPickCards}
  from "../public/lib/pick-filters.js";

function pick({
  player="Player One",sport="nfl",team="Dallas Cowboys",teamId="1",
  opponent="Tampa Bay Buccaneers",gameId="123456",market="Passing yards",
  position="QB",trend="recent",line=100,sample=5,
  similar=0,similarHits=0,recentSample=5,recentHits=5
}={}){
  return {player,sport,teamName:team,teamId,market,position,
    scanMode:trend,line,sample,similarSample:similar,similarHits,
    recentSample,recentHits,
    similarGames:Array.from({length:similar},(_,i)=>({
      gameId:"past"+i,value:100+i,opponent:"Historic Opponent "+i
    })),
    sourceGame:{id:gameId,date:"2026-10-08T19:00:00Z",
      away:{name:opponent},home:{name:team}}
  };
}

test("the automatic scan is permanently set to both OVER-only modes and three seasons",()=>{
  assert.deepEqual(FIXED_SCAN,{mode:"both",window:3,overOnly:true});
  assert.equal(Object.isFrozen(FIXED_SCAN),true);
  assert.equal(INITIAL_FILTERS.trend,"all");
  assert.equal(INITIAL_FILTERS.market,"all");
});

test("empty filters show all cards across the six sports without changing originals",()=>{
  const sports=["nfl","nba","mlb","ncaaf","ncaab","soccer"];
  const names=["Passing yards","Points","Hits","Receiving yards","Rebounds","Shots on target"];
  const all=sports.map((sport,i)=>pick({sport,market:names[i],player:"Athlete "+i}));
  const before=JSON.stringify(all);
  assert.equal(filterPickCards(all).length,6);
  assert.equal(JSON.stringify(all),before,"filtering must not mutate scan results");
  assert.equal(getPickOptions(all).markets.length,6);
});

test("search finds player and stat even with case differences, accents and multiple words",()=>{
  const all=[pick({player:"Dak Prescott",market:"Passing yards"}),
    pick({player:"Bucky Irving",market:"Rushing yards",position:"RB"})];
  assert.deepEqual(filterPickCards(all,{search:"DAK passING"}).map(p=>p.player),["Dak Prescott"]);
  assert.deepEqual(filterPickCards(all,{search:"bUcKy Rushing"}).map(p=>p.player),["Bucky Irving"]);
  assert.equal(filterPickCards(all,{search:"not on roster"}).length,0);
});

test("search also matches opponent and the player's team",()=>{
  const all=[
    pick({player:"Dak Prescott",team:"Dallas Cowboys",opponent:"New York Giants"}),
    pick({player:"Josh Allen",team:"Buffalo Bills",opponent:"Miami Dolphins"})
  ];
  assert.deepEqual(filterPickCards(all,{search:"miami"}).map(p=>p.player),["Josh Allen"]);
  assert.deepEqual(filterPickCards(all,{search:"dallas cowboys"}).map(p=>p.player),["Dak Prescott"]);
});

test("game filter works when up to sixteen selected matchups were scanned",()=>{
  const all=Array.from({length:16},(_,i)=>pick({
    gameId:String(100000+i),player:"Athlete "+i,
    teamId:String(i),team:"Team "+i
  }));
  assert.equal(filterPickCards(all,{game:"100009"}).length,1);
  assert.equal(filterPickCards(all,{game:"100009"})[0].player,"Athlete 9");
  assert.equal(getPickOptions(all).games.length,16);
});

test("team, exact market and position filters combine correctly",()=>{
  const all=[
    pick({player:"Receiver",teamId:"1",market:"Receiving yards",position:"WR"}),
    pick({player:"Tight End",teamId:"1",market:"Receiving yards",position:"TE"}),
    pick({player:"Bulls Guard",teamId:"2",market:"Points",position:"PG"})
  ];
  assert.deepEqual(filterPickCards(all,{
    team:"1",market:"Receiving yards",position:"WR"
  }).map(p=>p.player),["Receiver"]);
  assert.equal(filterPickCards(all,{team:"2",market:"Receiving yards"}).length,0);
  assert.deepEqual(getPickOptions(all).positions,["PG","TE","WR"]);
});

test("trend tabs distinguish actual 100%-recent and 100%-similar research cards",()=>{
  const all=[
    pick({player:"Recent",trend:"recent"}),
    pick({player:"Similar",trend:"similar",sample:4,similar:4,similarHits:4})
  ];
  assert.deepEqual(filterPickCards(all,{trend:"recent"}).map(p=>p.player),["Recent"]);
  assert.deepEqual(filterPickCards(all,{trend:"similar"}).map(p=>p.player),["Similar"]);
  assert.equal(filterPickCards(all,{trend:"all"}).length,2);
});

test("4 of 4 similar evidence requires four actual OVER hits, not only four available games",()=>{
  const all=[
    pick({player:"4/4",similar:4,similarHits:4}),
    pick({player:"3/4",similar:4,similarHits:3}),
    pick({player:"3/3",similar:3,similarHits:3}),
    pick({player:"No Similar",similar:0,similarHits:0})
  ];
  assert.deepEqual(filterPickCards(all,{evidence:"similar-perfect"}).map(p=>p.player),["4/4"]);
  assert.equal(filterPickCards(all,{evidence:"similar-any"}).length,3);
});

test("5/5 recent evidence requires all five hits this CURRENT season",()=>{
  const all=[
    pick({player:"5/5",recentSample:5,recentHits:5}),
    pick({player:"4/5",recentSample:5,recentHits:4}),
    pick({player:"4/4",recentSample:4,recentHits:4})
  ];
  assert.deepEqual(filterPickCards(all,{evidence:"recent-five-perfect"}).map(p=>p.player),["5/5"]);
});

test("only source-backed markets and games appear in filter dropdowns",()=>{
  const all=[
    pick({player:"One",team:"Dallas",gameId:"888888",market:"Receiving yards"}),
    pick({player:"Two",team:"Dallas",gameId:"888888",market:"Receiving yards"}),
    pick({player:"Three",team:"Buffalo",teamId:"2",gameId:"999999",market:"Receptions"})
  ];
  const options=getPickOptions(all);
  assert.deepEqual(options.markets,["Receiving yards","Receptions"]);
  assert.equal(options.teams.length,2);
  assert.equal(options.games.length,2);
  assert.ok(options.games.some(g=>g.value==="888888"));
  assert.ok(options.games.every(g=>g.label.includes("@")));
});

test("player filter is applied BEFORE pagination; the 130th card stays discoverable",()=>{
  const all=Array.from({length:160},(_,i)=>pick({
    player:i===129?"Hidden Star":"Athlete "+i
  }));
  assert.equal(filterPickCards(all,{search:"Hidden Star"}).length,1);
  assert.equal(filterPickCards(all,{search:"Hidden Star"})[0].player,"Hidden Star");
});

test("sort orders are stable and appropriate for individual sports",()=>{
  const all=[
    pick({player:"Zed",market:"Points",line:15,sample:3,trend:"recent"}),
    pick({player:"Alex",market:"Rebounds",line:5,sample:4,trend:"similar",similar:4,similarHits:4}),
    pick({player:"Bea",market:"Assists",line:7,sample:5,trend:"recent"})
  ];
  assert.deepEqual(filterPickCards(all,{sort:"player"}).map(p=>p.player),["Alex","Bea","Zed"]);
  assert.deepEqual(filterPickCards(all,{sort:"sample"}).map(p=>p.player),["Bea","Alex","Zed"]);
  assert.deepEqual(filterPickCards(all,{sort:"line-high"}).map(p=>p.player),["Zed","Bea","Alex"]);
  assert.deepEqual(filterPickCards(all,{sort:"line-low"}).map(p=>p.player),["Alex","Bea","Zed"]);
  assert.equal(filterPickCards(all,{sort:"similar"})[0].player,"Alex");
});

test("filtering zero results is a valid non-error state",()=>{
  const all=[pick({player:"Dak Prescott",market:"Passing yards"})];
  assert.deepEqual(filterPickCards(all,{market:"Hits"}),[]);
  assert.deepEqual(filterPickCards([],{search:"dak"}),[]);
  assert.deepEqual(getPickOptions([]),{games:[],teams:[],markets:[],positions:[]});
});

test("dropdown labels and search terms remain inert values, never executable markup",()=>{
  const x=pick({player:"<img src=x onerror=alert(1)>",market:"Hits"});
  assert.equal(filterPickCards([x],{search:"onerror"}).length,1);
  assert.equal(getPickOptions([x]).markets[0],"Hits");
});
