import test from "node:test";
import assert from "node:assert/strict";
import { onRequestGet } from "../functions/api/games.js";

test("Cloudflare endpoint rejects invalid sport without fetching", async () => {
  const response = await onRequestGet({request:new Request("https://example.pages.dev/api/games?sport=invalid&date=2026-10-08")});
  assert.equal(response.status,400);
});

test("Cloudflare endpoint rejects malformed date without fetching", async () => {
  const response = await onRequestGet({request:new Request("https://example.pages.dev/api/games?sport=nfl&date=2026-02-30")});
  assert.equal(response.status,400);
});

test("Cloudflare endpoint rejects invalid soccer league", async () => {
  const response = await onRequestGet({request:new Request("https://example.pages.dev/api/games?sport=soccer&league=invalid&date=2026-10-08")});
  assert.equal(response.status,400);
});

test("Cloudflare endpoint reports failures rather than pretending data exists", async () => {
  const original = globalThis.fetch;
  globalThis.fetch=async()=>new Response("Unavailable",{status:503});
  try {
    const response = await onRequestGet({request:new Request("https://example.pages.dev/api/games?sport=nba&date=2026-10-08")});
    assert.equal(response.status,502);
    const data=await response.json();
    assert.equal(data.error,"Schedules temporarily unavailable");
  } finally {
    globalThis.fetch=original;
  }
});

test("Cloudflare endpoint maps real upstream game structure",async()=>{
  const original=globalThis.fetch;
  globalThis.fetch=async()=>new Response(JSON.stringify({events:[
    {id:"100",date:"2026-10-08T23:00:00Z",status:{type:{description:"Scheduled"}},
      competitions:[{competitors:[
        {homeAway:"home",team:{displayName:"Home Club",logo:"https://example.org/home.svg"}},
        {homeAway:"away",team:{displayName:"Away Club",logo:"https://example.org/away.svg"}}
      ]}]}
  ]}),{headers:{"content-type":"application/json"}});
  try{
    const response=await onRequestGet({request:new Request("https://example.pages.dev/api/games?sport=nfl&date=2026-10-08")});
    assert.equal(response.status,200);
    const data=await response.json();
    assert.equal(data.games.length,1);
    assert.equal(data.games[0].home.name,"Home Club");
    assert.equal(data.oddsConnected,false);
  }finally{globalThis.fetch=original;}
});
