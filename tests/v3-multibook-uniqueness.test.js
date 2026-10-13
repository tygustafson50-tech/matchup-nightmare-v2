import test from "node:test";
import assert from "node:assert/strict";
import {normalizePropLineOdds} from "../functions/api/lines.js";
import {groupOffersByPlayerStat,selectBestOverCard}
  from "../public/lib/one-line-per-stat.js";
const now=Date.now();
const game={id:"401999111"};
const stamped=new Date(now-120000).toISOString();
function book(key,price,point=2.5){
  return {key,title:key,markets:[{key:"player_receptions",
    last_update:stamped,line_type:"main",outcomes:[
      {name:"Over",description:"Verified Receiver",point,price},
      {name:"Under",description:"Verified Receiver",point,price:-110}
    ]}]};
}
function offers(books){
  return normalizePropLineOdds([{id:"777",espn_event_id:game.id,
    home_team:"Buffalo Bills",away_team:"New York Jets",
    commence_time:"2026-10-12T00:20:00Z",bookmakers:books
  }],{sport:"nfl",date:"2026-10-11",now});
}
test("FanDuel and Bovada can provide valid props even with no DraftKings board",()=>{
  const rows=offers([book("fanduel",-115),book("bovada",-105)]);
  assert.equal(rows.length,2);
  assert.deepEqual(new Set(rows.map(x=>x.bookKey)),
    new Set(["fanduel","bovada"]));
  const groups=groupOffersByPlayerStat(rows.map(offer=>({offer,game})));
  assert.equal(groups.length,1);
  assert.equal(groups[0].offers.length,2);
});
test("multiple books and alt lines become one player-stat winner",()=>{
  const rows=offers([book("draftkings",-125),
    book("fanduel",-105),book("bovada",-110,1.5)]);
  const groups=groupOffersByPlayerStat(rows.map(offer=>({offer,game})));
  assert.equal(groups.length,1);
  const cards=groups[0].offers.map(o=>({
    id:o.id,line:o.line,price:o.price,quotedAt:o.quotedAt,
    recent:{tracked:5,hits:5},similar:{tracked:4,hits:4},
    recommendation:"OVER",offer:o
  }));
  const chosen=selectBestOverCard(cards);
  assert.equal(chosen.line,2.5);
  assert.equal(chosen.offer.bookKey,"fanduel");
  assert.equal(chosen.quotesConsidered,3);
});
test("PrizePicks real projection line is usable without fabricating sportsbook odds",()=>{
  const rows=offers([book("prizepicks",100)]);
  assert.equal(rows.length,1);
  assert.equal(rows[0].bookKey,"prizepicks");
  assert.equal(rows[0].price,null);
  assert.equal(rows[0].priceIsSynthetic,true);
  assert.equal(rows[0].line,2.5);
});
