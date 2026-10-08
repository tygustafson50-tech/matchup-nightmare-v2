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
  assert.match(app,/Current-season games/);
  assert.match(app,/Last 4 similar-defense matchups/);
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

test("all six sports share a searchable and sortable pick-filter toolbar",()=>{
  const html=readFileSync(new URL("../public/index.html",import.meta.url),"utf8");
  for(const id of [
    "pickFilters","filterSearch","filterMarket","filterGame","filterTeam",
    "filterPosition","filterEvidence","filterSort","filterReset",
    "pickTrendChips","pickResultCount"
  ])assert.match(html,new RegExp('id="'+id+'"'));
  assert.match(html,/4\/4 similar-defense OVER/);
  assert.match(html,/5\/5 recent-games OVER/);
  assert.match(html,/data-trend="recent"/);
  assert.match(html,/data-trend="similar"/);
});

test("pick filters apply before pagination and never trigger another scan",()=>{
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
