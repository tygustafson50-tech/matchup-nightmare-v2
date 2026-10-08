import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

test("browser scanner script parses without broken HTML string quoting",()=>{
  const source=readFileSync(new URL("../public/app.js",import.meta.url),"utf8");
  const imports=source.match(/^import .*;\r?\n/gm)||[];
  assert.ok(imports.length>=3,"Expected all scanner module imports.");
  const executable=source.replace(/^import .*;\r?\n/gm,"");
  assert.doesNotThrow(()=>new Function(executable));
});

test("automatic scan includes both history sections and transparent unavailable state",()=>{
  const app=readFileSync(new URL("../public/app.js",import.meta.url),"utf8");
  assert.match(app,/Recent 5 Games — Current Season Only/);
  assert.match(app,/Last 4 Matchups vs Similar Defenses/);
  assert.match(app,/similar-history-missing/);
  assert.match(app,/roster lookups successful/i);
  assert.match(app,/scanMoreCareers/);
});

test("client scanner has one fixed OVER-only 3-season history configuration",()=>{
  const html=readFileSync(new URL("../public/index.html",import.meta.url),"utf8");
  const app=readFileSync(new URL("../public/app.js",import.meta.url),"utf8");
  assert.match(html,/One-click scan:/);
  assert.match(html,/Scan Selected Games/);
  assert.doesNotMatch(html,/id="scanMode"|id="historyWindow"|02 \/ Scan settings/);
  assert.match(app,/const mode=FIXED_SCAN\.mode,window=FIXED_SCAN\.window/);
  assert.match(html,/not live PrizePicks lines/i);
});

test("all six sports display exactly stat, team and position filters",()=>{
  const html=readFileSync(new URL("../public/index.html",import.meta.url),"utf8");
  const present=["filterMarket","filterTeam","filterPosition"];
  for(const id of present)assert.match(html,new RegExp('id="'+id+'"'));
  const allIds=[...html.matchAll(/id="(filter[A-Za-z]+)"/g)].map(x=>x[1]);
  assert.deepEqual(allIds.sort(),present.sort());
  for(const removed of ["filterSearch","filterGame","filterEvidence","filterSort",
    "filterReset","pickTrendChips"])
    assert.doesNotMatch(html,new RegExp('id="'+removed+'"'));
  assert.match(html,/>Stats\s*</);
  assert.match(html,/>Team\s*</);
  assert.match(html,/>Position\s*</);
});

test("the three filters apply before pagination without rescanning",()=>{
  const app=readFileSync(new URL("../public/app.js",import.meta.url),"utf8");
  assert.match(app,/filterPickCards\(allPickCards,collectPickFilters\(\)\)/);
  assert.match(app,/matched\.slice\(0,visiblePickLimit\)/);
  assert.match(app,/visiblePickLimit\+=PAGE_SIZE/);
  assert.doesNotMatch(app,/all\.slice\(0,100\)/);
  assert.match(app,/scanMoreCareers/);
});

test("advanced manual research remains optional below automatic picks",()=>{
  const html=readFileSync(new URL("../public/index.html",import.meta.url),"utf8");
  assert.ok(html.indexOf('id="autoResults"')<html.indexOf('class="panel optional-research"'));
  assert.match(html,/id="scan"/);
  assert.match(html,/class="manual-research"/);
});
