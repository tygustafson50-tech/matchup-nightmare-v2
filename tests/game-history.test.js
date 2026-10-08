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


test("last four comparable games show each defense's actual same-role allowance",()=>{
  const rows=[
    {date:"2026-09-20",opponent:"Falcons",value:85,opponentAllowed:91.5,opponentDefenseGames:2},
    {date:"2026-09-14",opponent:"Saints",value:62,opponentAllowed:104,opponentDefenseGames:3}
  ];
  const html=renderGameHistory(rows,60,"Receiving yards",{
    heading:"Last 4 matchups vs similar positional defenses",
    countLabel:"2 of 4 available",showOpponentDefense:true
  });
  assert.match(html,/2 of 4 available/);
  assert.match(html,/Falcons/);
  assert.match(html,/Saints/);
  assert.match(html,/91\.5\/game/);
  assert.match(html,/2 pregame records/);
  assert.match(html,/104\.0\/game/);
  assert.match(html,/>85<\/strong>/);
  assert.match(html,/game-log-status over/);
});

test("opponent defensive averages are hidden when source evidence is incomplete",()=>{
  const rows=[
    {date:"2026-09-20",opponent:"No source",value:12,opponentAllowed:300,opponentDefenseGames:1}
  ];
  const html=renderGameHistory(rows,10,"Assists",{showOpponentDefense:true});
  assert.ok(!html.includes("Allowed 300"));
  assert.match(html,/No source/);
});


test("cross-season opponent rows include calendar year",()=>{
  const rows=[
    {date:"2024-09-08T18:00:00Z",opponent:"2024 Opponent",value:61},
    {date:"2025-09-14T18:00:00Z",opponent:"2025 Opponent",value:72},
    {date:"2026-09-20T18:00:00Z",opponent:"2026 Opponent",value:85}
  ];
  const html=renderGameHistory(rows,49.5,"Receiving yards",{
    heading:"Last 4 matchups vs similar positional defenses",
    showYear:true,limit:4
  });
  assert.match(html,/Sep 8, 2024/);
  assert.match(html,/Sep 14, 2025/);
  assert.match(html,/Sep 20, 2026/);
  assert.match(html,/2024 Opponent/);
});
