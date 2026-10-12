import test from "node:test";
import assert from "node:assert/strict";
import {onRequestGet} from "../functions/api/lines.js";

const line={
  id:"pp-111",sport:"nfl",player:"Verified Athlete",team:"Buffalo Bills",
  opponent:"Los Angeles Rams",position:"WR",gameId:"123456789",
  gameDateLocal:"2026-10-11",market:"Receiving yards",
  stat:"receivingYards",line:0.5,variant:"alternative",
  status:"active",quotedAt:new Date().toISOString(),
  espnPlayerId:"111",espnTeamId:"1"
};
const request=new Request("https://example.pages.dev/api/lines?sport=nfl&date=2026-10-11");
const env={PRIZEPICKS_FEED_APPROVED:"true",
  PRIZEPICKS_FEED_ENDPOINT:"https://authorized.provider.example/verified-lines",
  PRIZEPICKS_FEED_TOKEN:"never-send-to-browser"};
const mock=json=>async(url,init)=>{
  assert.equal(new URL(url).hostname,"authorized.provider.example");
  assert.equal(new URL(url).searchParams.get("sport"),"nfl");
  assert.equal(init.headers.Authorization,"Bearer never-send-to-browser");
  return new Response(JSON.stringify(json),{status:200,
    headers:{"content-type":"application/json"}});
};
async function callWith(json,extra={}){
  const before=globalThis.fetch;
  globalThis.fetch=mock(json);
  try{return await onRequestGet({request,env:{...env,...extra}});}
  finally{globalThis.fetch=before;}
}
const feed=overrides=>({source:"PrizePicks",fetchedAt:new Date().toISOString(),
  projections:[{...line,...overrides}]});

test("unauthorized and unconfigured provider is never treated as real PrizePicks",async()=>{
  const r=await onRequestGet({request,env:{}});
  assert.equal(r.status,503);
  const d=await r.json();
  assert.equal(d.status,"integration-required");
  assert.deepEqual(d.projections,[]);
  const withheld=await onRequestGet({request,env:{...env,PRIZEPICKS_FEED_APPROVED:"false"}});
  assert.equal(withheld.status,503);
});
test("verified low alternative PrizePicks lines keep their exact numeric values",async()=>{
  const r=await callWith(feed());
  assert.equal(r.status,200);
  const d=await r.json();
  assert.equal(d.status,"connected");
  assert.equal(d.projections.length,1);
  assert.equal(d.projections[0].line,0.5);
  assert.equal(d.projections[0].variant,"alternative");
  assert.equal(d.projections[0].source,"PrizePicks");
  assert.equal(JSON.stringify(d).includes("never-send-to-browser"),false);
});
test("stale, forged, and missing projection evidence fails closed",async()=>{
  let r=await callWith(feed({line:null}));
  assert.equal(r.status,502);
  r=await callWith({...feed(),source:"Unknown Sportsbook"});
  assert.equal(r.status,502);
  const past=new Date(Date.now()-3600_000).toISOString();
  r=await callWith(feed({quotedAt:past}));
  assert.equal(r.status,502);
  r=await callWith({...feed(),fetchedAt:past});
  assert.equal(r.status,502);
});
test("removed or suspended lines are never recommendations",async()=>{
  const r=await callWith({...feed(),projections:[
    {...line,status:"suspended"},
    {...line,id:"pp-222",status:"removed"},
    {...line,id:"pp-333",line:1.5,variant:"standard"}
  ]});
  const d=await r.json();
  assert.equal(d.projections.length,1);
  assert.equal(d.projections[0].id,"pp-333");
  assert.equal(d.suspended.length,2);
});
test("KV line movement and removal are detected using actual previously verified IDs",async()=>{
  let stored=null;
  const kv={get:async()=>stored,put:async(_key,data)=>{stored=data;}};
  let r=await callWith(feed(),{PROJECTION_SNAPSHOTS:kv});
  assert.equal((await r.json()).changeTracking,"baseline-created");
  r=await callWith({...feed(),projections:[
    {...line,line:2.5},{...line,id:"pp-222",line:3.5}
  ]},{PROJECTION_SNAPSHOTS:kv});
  const data=await r.json();
  assert.deepEqual(data.changes.map(x=>x.kind),["changed","added"]);
  r=await callWith({...feed(),projections:[{...line,id:"pp-222",line:3.5}]},
    {PROJECTION_SNAPSHOTS:kv});
  assert.equal((await r.json()).changes[0].kind,"removed");
});
