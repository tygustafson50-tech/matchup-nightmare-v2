import test from "node:test";
import assert from "node:assert/strict";
import {groupOffersByPlayerStat,selectBestOverCard,compareOverEvidence,
  dedupeVerifiedCards} from "../public/lib/one-line-per-stat.js";

const game={id:"401999111",home:{id:"1",name:"Los Angeles Rams"},
  away:{id:"2",name:"Buffalo Bills"}};
function quote({id,player="Matthew Stafford",stat="rushingYards",
  sport="nfl",line=0.5,book="draftkings",espnPlayerId=null}){
  return {id,player,stat,sport,line,bookKey:book,espnPlayerId,
    variant:line===5.5?"standard":"alternative",status:"active",
    source:"PropLine",quotedAt:"2026-10-11T23:25:00Z"};
}
function card({id,line,stat="rushingYards",hitsRecent=5,
  hitsSimilar=4,recentSample=5,similarSample=4,price=-110,
  espnPlayerId="12345",sport="nfl",name="Matthew Stafford"}){
  return {id,player:name,stat,sport,date:"2026-10-12",line,price,
    recent:{tracked:recentSample,hits:hitsRecent,percent:
      recentSample?100*hitsRecent/recentSample:null},
    similar:{tracked:similarSample,hits:hitsSimilar,percent:
      similarSample?100*hitsSimilar/similarSample:null},
    recommendation:hitsRecent>=3&&hitsSimilar>=3?"OVER":null,
    quotedAt:"2026-10-11T23:25:00Z",offer:{
      espnPlayerId,gameId:"401999111",source:"PropLine"
    }};
}

test("Stafford's four real rushing lines become ONE player/stat scan with four candidate quotes",()=>{
  const lines=[0.5,1.5,2.5,5.5];
  const offers=lines.map((line,i)=>({
    offer:quote({id:"rush-"+i,line,book:i%2?"fanduel":"draftkings"}),game
  }));
  // Different category remains a distinct stat card, not absorbed into rushing.
  offers.push({offer:quote({id:"passing",stat:"passingYards",line:210.5}),game});
  offers.push({offer:quote({id:"rush-1",line:1.5}),game});
  const groups=groupOffersByPlayerStat(offers);
  assert.equal(groups.length,2);
  const rushing=groups.find(x=>x.offers[0].stat==="rushingYards");
  assert.equal(rushing.offers.length,4);
  assert.equal(rushing.identityConflict,false);
});

test("prefer 100% with verified similar defenses over a higher line that misses",()=>{
  const best=selectBestOverCard([
    card({id:"rush-0",line:0.5}),
    card({id:"rush-1",line:1.5,hitsSimilar:3}),
    card({id:"rush-2",line:2.5,hitsRecent:4,hitsSimilar:3}),
    card({id:"rush-3",line:5.5,hitsRecent:2,hitsSimilar:1})
  ]);
  assert.equal(best.id,"rush-0");
  assert.equal(best.line,0.5);
  assert.equal(best.quotesConsidered,4);
});

test("when multiple genuine lines hit 100%, select highest evidenced OVER line",()=>{
  const best=selectBestOverCard([
    card({id:"low",line:0.5}),
    card({id:"medium",line:1.5}),
    card({id:"upper",line:2.5}),
    card({id:"high",line:5.5,hitsSimilar:2})
  ]);
  assert.equal(best.id,"upper");
  assert.equal(best.line,2.5);
});

test("same line across books picks better REAL quote instead of displaying a duplicate",()=>{
  const weaker=card({id:"dk",line:2.5,price:-125});
  const better=card({id:"fd",line:2.5,price:-105});
  assert.ok(compareOverEvidence(better,weaker)>0);
  assert.equal(selectBestOverCard([weaker,better]).id,"fd");
});

test("if histories are insufficient, still show at most one line with no false OVER",()=>{
  const first=card({id:"a",line:0.5,recentSample:2,similarSample:0,
    hitsRecent:2,hitsSimilar:0});
  const second=card({id:"b",line:2.5,recentSample:2,similarSample:0,
    hitsRecent:1,hitsSimilar:0});
  assert.equal(selectBestOverCard([second,first]).id,"a");
  assert.equal(selectBestOverCard([first,second]).recommendation,null);
});

test("verified athlete ID resolves differences in sportsbook spellings",()=>{
  const one=card({id:"a",line:0.5,name:"Matt Stafford"});
  const two=card({id:"b",line:2.5,name:"Matthew Stafford"});
  one.quotesConsidered=3;two.quotesConsidered=2;
  const unique=dedupeVerifiedCards([one,two]);
  assert.equal(unique.length,1);
  assert.equal(unique[0].id,"b");
  assert.equal(unique[0].quotesConsidered,5);
});

test("never merge different stats, games, athletes, or sports",()=>{
  const base=card({id:"a",line:1.5});
  const others=[
    base,
    card({id:"b",line:60.5,stat:"passingYards"}),
    card({id:"c",line:1.5,espnPlayerId:"55555"}),
    card({id:"d",line:1.5,sport:"ncaaf"}),
    {...card({id:"e",line:1.5}),offer:{
      gameId:"another-game",espnPlayerId:"12345",source:"PropLine"
    }}
  ];
  assert.equal(dedupeVerifiedCards(others).length,5);
});

test("conflicting source athlete IDs within a single named market flagged, not silently merged",()=>{
  const result=groupOffersByPlayerStat([
    {offer:quote({id:"1",espnPlayerId:"12"}),game},
    {offer:quote({id:"2",espnPlayerId:"999"}),game}
  ]);
  assert.equal(result.length,1);
  assert.equal(result[0].identityConflict,true);
});

test("all six sports use identical one-card-per-player-stat constraint",()=>{
  for(const sport of ["nfl","nba","mlb","ncaaf","ncaab","soccer"]){
    const arr=groupOffersByPlayerStat([0.5,1.5,2.5,3.5].map((line,i)=>({
      game,offer:quote({id:"x-"+i,player:"Same Verified Player",stat:"assists",sport,line})
    })));
    assert.equal(arr.length,1,sport);
    assert.equal(arr[0].offers.length,4,sport);
  }
});

test("one actual selected fixture collapses five Jordan Whittington rushing ALT cards even with inconsistent provider IDs",()=>{
  const playerId="555555";
  const five=[0.5,1.5,2.5,3.5,5.5].map((line,i)=>({
    ...card({id:"whit-"+i,line,espnPlayerId:playerId,name:"Jordan Whittington"}),
    fixtureId:"401999111",quotesConsidered:1,
    book:"DraftKings",bookKey:"draftkings",
    offer:{
      gameId:i%2?"another-provider-game-id":"401999111",
      providerEventId:"provider-alt-"+i,
      espnPlayerId:playerId,source:"PropLine",bookKey:"draftkings"
    }
  }));
  const unique=dedupeVerifiedCards(five);
  assert.equal(unique.length,1);
  assert.equal(unique[0].stat,"rushingYards");
  assert.equal(unique[0].bookKey,"draftkings");
  assert.equal(unique[0].quotesConsidered,5);
});

test("one sportsbook still groups standard and alt lines into exactly one market per game",()=>{
  const offers=[0.5,1.5,2.5,3.5,5.5].map((line,i)=>({
    offer:quote({id:"draftkings-whittington-"+i,player:"Jordan Whittington",
      stat:"rushingYards",book:"draftkings",line}),game
  }));
  const groups=groupOffersByPlayerStat(offers);
  assert.equal(groups.length,1);
  assert.equal(groups[0].offers.length,5);
});
