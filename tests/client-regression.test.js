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

test("client scanner preserves 3-season default and does not fake PrizePicks markets",()=>{
  const html=readFileSync(new URL("../public/index.html",import.meta.url),"utf8");
  assert.match(html,/value="3" selected/);
  assert.match(html,/Scan Selected Games/);
  assert.match(html,/research-only, NOT actual PrizePicks lines/i);
});
