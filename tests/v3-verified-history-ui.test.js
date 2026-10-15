import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {renderVerifiedHistory} from "../public/lib/verified-history-ui.js";
import {analyzeVerifiedProp} from "../public/lib/research-v3.js";
import {parseFootballDefenseRanks} from "../public/lib/football-defense-ranks.js";

const dateFmt=x=>x.slice(0,10);
const games=[
  {id:"401",date:"2026-10-04T17:00:00Z",opponent:"Chicago Bears",
    actual:73,source:"ESPN game summary",verified:true,
    rankLane:"passing",historicalRank:27,targetRank:28,
    defenseReason:"ESPN season defense comparison"},
  {id:"402",date:"2025-11-14T18:00:00Z",opponent:"Arizona Cardinals",
    actual:32,source:"ESPN game summary",verified:true,
    rankLane:"passing",historicalRank:30,targetRank:28,
    defenseReason:"ESPN season defense comparison"},
  {id:"403",date:"2024-09-11T18:00:00Z",opponent:"Seattle Seahawks",
    actual:49.5,verified:true,rankLane:"passing",historicalRank:29,
    targetRank:28}
];

test("verified receiving-yards games expose the actual yards for EACH verified matchup",()=>{
  const html=renderVerifiedHistory({label:"Similar Defenses — Last 3 Seasons",
    games,line:49.5,market:"Receiving yards",similar:true,formatDate:dateFmt});
  assert.match(html,/<h3>Similar Defenses — Last 3 Seasons<\/h3>/);
  assert.match(html,/3 verified games/);
  for(const [opponent,actual] of [["Chicago Bears",73],["Arizona Cardinals",32],["Seattle Seahawks",49.5]]){
    assert.match(html,new RegExp(opponent));
    assert.ok(html.includes('<strong class="verified-actual-number">'+String(actual)+'</strong>'));
  }
  assert.match(html,/<strong class="verified-actual-number">73<\/strong>\s*<small class="verified-actual-unit">Receiving yards<\/small>/);
  assert.match(html,/vs current line 49.5/);
  assert.match(html,/>OVER<\/strong>/);
  assert.match(html,/>UNDER<\/strong>/);
  assert.match(html,/>PUSH<\/strong>/);
  assert.match(html,/historical #27 · upcoming #28/);
  assert.match(html,/<details class="verified-game-history/);
  assert.match(html,/<summary class="verified-history-toggle">/);
  assert.match(html,/<strong class="verified-history-hits"[^>]*>1\/3<\/strong>/);
  assert.doesNotMatch(html,/<details[^>]*\sopen(?:\s|=|>)/);
  assert.equal((html.match(/class="verified-actual-number"/g)||[]).length,3);
});

test("all six sports show their correct specific stat, not generic counts or yards",()=>{
  for(const market of ["Rushing yards","Rush attempts","Pass completions",
    "Receptions","Points","Assists","Pitcher strikeouts","Total bases","Shots"]){
    const html=renderVerifiedHistory({label:"Comparable matches",
      games:[games[0]],line:1.5,market,similar:true,formatDate:dateFmt});
    assert.match(html,new RegExp('<small class="verified-actual-unit">'+market+"</small>"));
    assert.match(html,new RegExp('<span role="columnheader">Actual '+market+"</span>"));
  }
});

test("an unavailable or nonnumeric recorded stat cannot be shown as 0, OVER, or a new sample",()=>{
  const html=renderVerifiedHistory({label:"Comparable matches",
    games:[{...games[0],actual:NaN},{...games[1],actual:null},
      {...games[2],actual:undefined}],line:49.5,
    market:"Receiving yards",similar:true});
  assert.match(html,/0 verified games/);
  assert.match(html,/No verified game statistics available/);
  assert.doesNotMatch(html,/verified-actual-number/);
});

test("escaped player opponents and market fields cannot inject unsafe markup",()=>{
  const html=renderVerifiedHistory({label:"<script>bad</script>",
    games:[{...games[0],opponent:"<img src=x onerror=evil()>"}],
    line:1.5,market:"Receptions <x>",similar:true});
  assert.doesNotMatch(html,/<script>|<img src=x/);
  assert.match(html,/&lt;script&gt;/);
  assert.match(html,/&lt;img src=x/);
});

test("recent and similar histories are collapsed by default and still prioritize similar evidence",()=>{
  const app=readFileSync(new URL("../public/app.js",import.meta.url),"utf8");
  assert.match(app,/import \{renderVerifiedHistory\}/);
  assert.match(app,/market=c.market|c\.line,true,c\.market/);
  assert.doesNotMatch(app,/historyBlock\("Similar Defenses[^\n]+,true\)\+/);
  assert.ok(app.indexOf('historyBlock("Similar Defenses')<
    app.indexOf('historyBlock("Recent Matchups'));
  assert.match(app,/historyBlock\("Recent Matchups — Last 5 Games"/);
});

test("ESPN recorded results pass through the real rank-based research and remain numeric",()=>{
  const source=(year,id,rank)=>({
    requestedSeason:year,team:{id:String(id)},results:{opponent:[
      {name:"passing",stats:[{name:"netPassingYards",rank,perGameValue:210}]},
      {name:"rushing",stats:[{name:"rushingYards",rank:14,perGameValue:110}]}
    ]}
  });
  const offer={id:"q-1",source:"PropLine",book:"DraftKings",
    bookKey:"draftkings",sport:"nfl",status:"active",player:"Verified WR",
    team:"Bills",opponent:"Rams",position:"WR",
    stat:"receivingYards",market:"Receiving yards",line:49.5,
    variant:"standard",quotedAt:"2026-10-11T19:00:00Z",
    gameDateLocal:"2026-10-12",espnPlayerId:"33"};
  const history=games.map((g,i)=>({
    ...g,season:2025-i,date:(2025-i)+g.date.slice(4),sport:"nfl",playerId:"33",
    stat:"receivingYards",opponentId:String(100+i),
    source:"ESPN game summary",verified:true
  }));
  const profiles=history.map(g=>({
    ...parseFootballDefenseRanks(source(g.season,g.opponentId,27),
       {season:g.season,teamId:g.opponentId}),gameId:g.id
  }));
  const target=parseFootballDefenseRanks(source(2026,14,28),
     {season:2026,teamId:14});
  const result=analyzeVerifiedProp({offer,season:2026,games:history,
    upcomingDefense:target,defensiveProfiles:profiles,matchupModel:"nfl-ranks"});
  assert.equal(result.similar.tracked,3);
  assert.deepEqual(result.similarGames.map(g=>g.actual),[73,32,49.5]);
  const output=renderVerifiedHistory({label:"Similar Defenses",
    games:result.similarGames,line:offer.line,market:offer.market,
    similar:true,formatDate:dateFmt});
  assert.match(output,/73/);
  assert.match(output,/32/);
  assert.match(output,/49.5/);
  assert.match(output,/3 verified games/);
});

test("collapsed recent matchup header shows 4/5 exact real OVER hits",()=>{
  const five=[10,20,30,40,0].map((actual,i)=>({
    id:"r"+i,date:"2026-10-0"+(i+1)+"T18:00:00Z",
    opponent:"Verified Team "+i,actual
  }));
  const html=renderVerifiedHistory({label:"Recent Matchups — Last 5 Games",
    games:five,line:5.5,market:"Receptions",formatDate:dateFmt});
  assert.match(html,/<summary class="verified-history-toggle">/);
  assert.match(html,/<strong class="verified-history-hits"[^>]*>4\/5<\/strong>/);
  assert.match(html,/aria-label="4 OVER out of 5 verified games"/);
  assert.match(html,/Recent Matchups — Last 5 Games/);
  assert.doesNotMatch(html,/<details[^>]*\sopen(?:\s|=|>)/);
  assert.equal((html.match(/class="verified-actual-number"/g)||[]).length,5);
});
test("collapsed similar defenses header shows 4/4 from four actual historical games",()=>{
  const four=[71,62,89,75].map((actual,i)=>({
    id:"s"+i,date:"2025-10-0"+(i+1)+"T18:00:00Z",
    opponent:"Rank-matched Defense "+i,actual,
    similarity:92-i
  }));
  const html=renderVerifiedHistory({label:"Similar Defenses — Last 3 Seasons",
    games:four,line:54.5,market:"Receiving yards",similar:true,
    formatDate:dateFmt});
  assert.match(html,/<strong class="verified-history-hits"[^>]*>4\/4<\/strong>/);
  assert.match(html,/4 verified games/);
  assert.match(html,/Similar Defenses — Last 3 Seasons/);
  assert.equal((html.match(/class="verified-actual-number"/g)||[]).length,4);
});
test("PUSH is not OVER; invalid or missing stats do not inflate closed hit fractions",()=>{
  const html=renderVerifiedHistory({label:"Recent Matchups",
    games:[
      {...games[0],actual:9},
      {...games[1],actual:5},
      {...games[2],actual:1},
      {...games[0],id:"bad",actual:null},
      {...games[1],id:"bad2",actual:NaN}
    ],line:5,market:"Points"});
  assert.match(html,/>1\/3<\/strong>/);
  assert.match(html,/aria-label="1 OVER out of 3 verified games"/);
  assert.equal((html.match(/class="verified-actual-number"/g)||[]).length,3);
});
test("empty section does not imply 0/0 hit rate or a verified OVER",()=>{
  const html=renderVerifiedHistory({label:"Similar Defenses",
    games:[],line:4.5,market:"Receptions",similar:true});
  assert.match(html,/<strong class="verified-history-hits"[^>]*>—<\/strong>/);
  assert.match(html,/0 verified games/);
  assert.doesNotMatch(html,/>0\/0</);
});
test("native closed dropdowns are keyboard-accessible without extra JS",()=>{
  const html=renderVerifiedHistory({label:"Similar Defenses",games,
    line:49.5,market:"Receiving yards",similar:true});
  assert.equal((html.match(/<details\b/g)||[]).length,1);
  assert.equal((html.match(/<summary\b/g)||[]).length,1);
  assert.equal((html.match(/<\/summary>/g)||[]).length,1);
  assert.equal((html.match(/<\/details>/g)||[]).length,1);
  const stylesheet=readFileSync(new URL("../public/styles.css",import.meta.url),"utf8");
  assert.match(stylesheet,/summary:focus-visible/);
  assert.match(stylesheet,/verified-history-chevron/);
  assert.match(stylesheet,/\.verified-game-history\[open\]/);
});
