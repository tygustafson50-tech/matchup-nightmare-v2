import test from "node:test";
import assert from "node:assert/strict";
import {onRequestGet} from "../functions/api/espn.js";

test("reject unsupported sport, kind and bad resource IDs without making an upstream request",async()=>{
  const old=globalThis.fetch;
  globalThis.fetch=async()=>{throw Error("Should never call ESPN");};
  try{
    for(const path of [
      "/api/espn?sport=invalid&kind=schedule&teamId=1&season=2026",
      "/api/espn?sport=nfl&kind=other&gameId=123456",
      "/api/espn?sport=nfl&kind=summary&gameId=https://evil.test",
      "/api/espn?sport=nfl&kind=schedule&teamId=../../secret&season=2026",
      "/api/espn?sport=soccer&league=invalid&kind=summary&gameId=123456",
      "/api/espn?sport=mlb&kind=roster&teamId=1&season=foo",
      "/api/espn?sport=nfl&kind=gamelog&playerId=abc&season=2026"
    ]){
      const response=await onRequestGet({request:new Request("https://example.pages.dev"+path)});
      assert.equal(response.status,400,path);
    }
  }finally{globalThis.fetch=old;}
});

test("an ESPN summary request streams one JSON document, not a heavy aggregation",async()=>{
  const original=globalThis.fetch;
  const urls=[];
  globalThis.fetch=async url=>{
    urls.push(String(url));
    return new Response(JSON.stringify({gameId:"401200001",boxscore:{players:[]}}),{
      headers:{"content-type":"application/json"}
    });
  };
  try{
    const res=await onRequestGet({request:new Request(
      "https://example.pages.dev/api/espn?sport=nfl&kind=summary&gameId=401200001"
    )});
    assert.equal(res.status,200);
    assert.equal((await res.json()).gameId,"401200001");
    assert.equal(urls.length,1);
    assert.match(urls[0],/site\.api\.espn\.com\/apis\/site\/v2\/sports\/football\/nfl\/summary\?event=401200001/);
    assert.equal(res.headers.get("x-espn-resource"),"summary");
  }finally{globalThis.fetch=original;}
});

test("all six sports keep server-side source URL restricted to actual ESPN host",async()=>{
  const before=globalThis.fetch,urls=[];
  globalThis.fetch=async url=>{
    urls.push(String(url));
    return new Response(JSON.stringify({events:[]}),{
      headers:{"content-type":"application/json"}
    });
  };
  try{
    for(const [sport,league] of [
      ["nfl",""],["nba",""],["mlb",""],["ncaaf",""],["ncaab",""],
      ["soccer","esp.1"]
    ]){
      const u="https://example.pages.dev/api/espn?sport="+sport+
        "&kind=schedule&teamId=1&season=2025"+
        (league?"&league="+league:"");
      assert.equal((await onRequestGet({request:new Request(u)})).status,200);
    }
    assert.equal(urls.length,6);
    assert.ok(urls.every(url=>url.startsWith(
      "https://site.api.espn.com/apis/site/v2/sports/")));
    assert.match(urls[5],/soccer\/esp\.1/);
  }finally{globalThis.fetch=before;}
});

test("upstream provider 503 returns explicit 502 JSON with source status",async()=>{
  const old=globalThis.fetch;
  globalThis.fetch=async()=>new Response("Busy",{status:503,headers:{"content-type":"text/html"}});
  try{
    const result=await onRequestGet({request:new Request(
      "https://example.pages.dev/api/espn?sport=nfl&kind=roster&teamId=1&season=2026"
    )});
    assert.equal(result.status,502);
    const body=await result.json();
    assert.equal(body.sourceStatus,503);
    assert.match(body.error,/roster source unavailable/);
  }finally{globalThis.fetch=old;}
});

test("HTML instead of provider JSON is rejected, not mistaken for an empty game log",async()=>{
  const old=globalThis.fetch;
  globalThis.fetch=async()=>new Response("<html>blocked</html>",{
    headers:{"content-type":"text/html"}
  });
  try{
    const result=await onRequestGet({request:new Request(
      "https://example.pages.dev/api/espn?sport=ncaab&kind=summary&gameId=401200001"
    )});
    assert.equal(result.status,502);
    assert.match((await result.json()).error,/did not return a JSON document/);
  }finally{globalThis.fetch=old;}
});
