import test from "node:test";
import assert from "node:assert/strict";
import {readableGameDate,renderGameHistory} from "../public/lib/game-history.js";

test("records exact opponent, date, stat and over/under status for every market",()=>{
  for(const market of ["Passing yards","Points","Hits","Rushing yards","Assists","Shots on target"]){
    const table=renderGameHistory([
      {date:"2026-10-01T19:00:00Z",opponent:"Opponent A",value:60},
      {date:"2026-09-25T19:00:00Z",opponent:"Opponent B",value:45},
      {date:"2026-09-20T19:00:00Z",opponent:"Opponent C",value:49.5}
    ],49.5,market,{heading:"Recent games"});
    assert.ok(table.includes("Opponent A"));
    assert.ok(table.includes("Opponent B"));
    assert.ok(table.includes("Oct 1"));
    assert.ok(table.includes(market));
    assert.match(table,/game-log-status over/);
    assert.match(table,/game-log-status below/);
    assert.match(table,/game-log-status push/);
    assert.match(table,/>60<\/strong>/);
    assert.match(table,/>45<\/strong>/);
  }
});

test("missing stats do not become fabricated zeros",()=>{
  const table=renderGameHistory([
    {date:"2026-10-02",opponent:"Missing",value:null},
    {date:"2026-10-01",opponent:"Actual",value:4}
  ],2,"Assists");
  assert.ok(!table.includes("Missing"));
  assert.ok(table.includes("Actual"));
  assert.ok(table.includes("4"));
});

test("user and provider strings are escaped against HTML injection",()=>{
  const table=renderGameHistory([{date:"2026-10-01",opponent:'<img src=x onerror="bad()">',value:2}],1,"Shots <script>");
  assert.ok(table.includes("&lt;img"));
  assert.ok(table.includes("&lt;script&gt;"));
  assert.ok(!table.includes('<img src=x'));
});

test("calendar dates are stable across time zones",()=>{
  assert.equal(readableGameDate("2026-10-08T01:00:00Z"),"Oct 8");
  assert.equal(readableGameDate("bad"),"Date unavailable");
});

test("no supplied games shows an honest availability warning",()=>{
  assert.match(renderGameHistory([],4,"Rebounds"),/No verified recorded games available/);
});


test("same last-four component labels opponent and actual stat without padding",()=>{
  const rows=[
    {date:"2026-09-22T01:00:00Z",opponent:"Falcons",value:8},
    {date:"2026-09-14T01:00:00Z",opponent:"Saints",value:4},
    {date:"2026-09-07T01:00:00Z",opponent:"Panthers",value:6}
  ];
  const html=renderGameHistory(rows,5,"Receptions",{
    heading:"Last 4 matchups vs similar defenses",
    limit:4,
    countLabel:"3 of 4 available"
  });
  assert.match(html,/Last 4 matchups vs similar defenses/);
  assert.match(html,/3 of 4 available/);
  assert.match(html,/Falcons/);
  assert.match(html,/Saints/);
  assert.match(html,/Panthers/);
  assert.match(html,/>8<\/strong>/);
  assert.match(html,/>4<\/strong>/);
  assert.match(html,/game-log-status below/);
  assert.match(html,/game-log-status over/);
  assert.ok(!html.includes("undefined"));
});

test("missing similar-defense history shows a titled honest no-data state",()=>{
  const html=renderGameHistory([],8,"Points",{
    heading:"Last 4 matchups vs similar defenses",
    countLabel:"0 of 4 available",
    emptyMessage:"No comparable opponents found in available data."
  });
  assert.match(html,/Last 4 matchups vs similar defenses/);
  assert.match(html,/0 of 4 available/);
  assert.match(html,/No comparable opponents/);
  assert.ok(!html.includes(">0</strong>"));
});
