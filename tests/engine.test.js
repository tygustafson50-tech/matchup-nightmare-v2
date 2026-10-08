import test from "node:test";import assert from "node:assert/strict";import {hitRate,parseLogs,analyze} from "../lib/engine.js";
test("OVER must strictly exceed line, push counted",()=>assert.deepEqual(hitRate([{value:2},{value:3},{value:4}],3),{hits:1,total:3,pushes:1,percentage:33.3}));
test("empty sample has null percentage",()=>assert.equal(hitRate([],3).percentage,null));
test("invalid lines rejected",()=>assert.deepEqual(parseLogs("bad,X,10,20").bad,[1]));
test("valid log parsed",()=>assert.equal(parseLogs("2026-10-01,A,25,20").games[0].value,25));
test("similar matchup filters by relative defensive allowed",()=>assert.equal(analyze([{date:"2026-10-01",value:4,allowed:10},{date:"2026-10-02",value:5,allowed:30}],3,10).similar.total,1));
test("100% trend requires at least 3 comparable games",()=>assert.equal(analyze([{date:"2026-10-01",value:4,allowed:10},{date:"2026-10-02",value:5,allowed:10}],3,10).historical100,false));
test("3 of 3 comparable qualifies historical 100%",()=>assert.equal(analyze([{date:"2026-10-01",value:4,allowed:10},{date:"2026-10-02",value:5,allowed:10},{date:"2026-10-03",value:6,allowed:10}],3,10).historical100,true));
