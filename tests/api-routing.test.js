import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {parseApiResponse} from "../public/lib/api-client.js";
import {onRequestGet as health} from "../functions/api/health.js";
import {onRequest as jsonMiddleware} from "../functions/api/_middleware.js";

test("Cloudflare API health endpoint responds immediately with JSON",async()=>{
  const response=health();
  assert.equal(response.status,200);
  assert.match(response.headers.get("content-type"),/application\/json/);
  const payload=await response.json();
  assert.equal(payload.ok,true);
  assert.match(payload.apiRoutes.join(" "),/\/api\/scan/);
});

test("a successful JSON scan response passes validation",async()=>{
  const r=new Response(JSON.stringify({seasonBatch:{season:2026},count:1}),{
    status:200,headers:{"content-type":"application/json; charset=utf-8"}
  });
  const value=await parseApiResponse(r,"/api/scan");
  assert.equal(value.seasonBatch.season,2026);
});

test("HTML SPA fallback is rejected, never interpreted as zero picks",async()=>{
  const r=new Response("<!DOCTYPE html><html><body>Matchup Nightmare</body></html>",{
    status:200,headers:{"content-type":"text/html"}
  });
  await assert.rejects(parseApiResponse(r,"/api/scan"),/Cloudflare returned its website/);
});

test("HTML error page is reported even when HTTP status is 500",async()=>{
  const r=new Response("<!DOCTYPE html><html>Worker failure</html>",{
    status:500,headers:{"content-type":"text/html"}
  });
  await assert.rejects(parseApiResponse(r,"/api/career"),/HTTP 500/);
});

test("JSON source errors include the server's explanation",async()=>{
  const r=new Response(JSON.stringify({error:"No accessible completed schedules",details:"Provider HTTP 503"}),{
    status:503,headers:{"content-type":"application/json"}
  });
  await assert.rejects(parseApiResponse(r,"/api/scan"),/No accessible completed schedules/);
});

test("invalid JSON and missing content type reject safely",async()=>{
  await assert.rejects(parseApiResponse(new Response("{invalid",{headers:{
    "content-type":"application/json"}}),"/api/scan"),/malformed JSON/);
  await assert.rejects(parseApiResponse(new Response("{}",{status:200}),"/api/scan"),
    /unexpected response format/);
});

test("Cloudflare API middleware turns static HTML into a JSON 503",async()=>{
  const response=await jsonMiddleware({
    request:new Request("https://example.pages.dev/api/scan"),
    next:async()=>new Response("<!DOCTYPE html><html>website</html>",{
      headers:{"content-type":"text/html"},status:200
    })
  });
  assert.equal(response.status,503);
  const body=await response.json();
  assert.match(body.error,/webpage/);
  assert.equal(body.scanCompleted,false);
});

test("middleware preserves verified JSON and catches thrown runtime errors",async()=>{
  const response=await jsonMiddleware({
    request:new Request("https://example.pages.dev/api/health"),
    next:async()=>new Response(JSON.stringify({ok:true}),{
      headers:{"content-type":"application/json; charset=utf-8"}
    })
  });
  assert.equal((await response.json()).ok,true);
  const bad=await jsonMiddleware({
    request:new Request("https://example.pages.dev/api/scan"),
    next:async()=>{throw Error("Provider exploded");}
  });
  assert.equal(bad.status,502);
  assert.match((await bad.json()).details,/Provider exploded/);
});

test("Pages Functions routing manifest explicitly includes all /api paths",()=>{
  const config=JSON.parse(readFileSync(new URL("../public/_routes.json",import.meta.url),"utf8"));
  assert.deepEqual(config,{version:1,include:["/api/*"],exclude:[]});
});

test("website scan uses home and away focused backend calls",()=>{
  const js=readFileSync(new URL("../public/app.js",import.meta.url),"utf8");
  assert.match(js,/focusTeam:side/);
  assert.match(js,/part\("home"\),part\("away"\)/);
  assert.match(js,/parseApiResponse\(r,"\/api\/scan/);
  assert.match(js,/Scan unavailable — no picks were calculated/);
});
