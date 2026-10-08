import test from "node:test";
import assert from "node:assert/strict";
import {onRequestGet} from "../functions/api/scan.js";

const iso=date=>date+"T19:00:00Z";
function event(id,date,a,b,season=2026){
  return {id:String(id),date:iso(date),season:{year:season},
    status:{type:{completed:true}},competitions:[{competitors:[
      {team:{id:String(a),displayName:"Team "+a},score:"24"},
      {team:{id:String(b),displayName:"Team "+b},score:"21"}
    ]}]};
}
const scheduled={id:"123456789",date:iso("2026-10-08"),season:{year:2026},
  competitions:[{competitors:[
    {homeAway:"home",team:{id:"1",displayName:"Home Team"}},
    {homeAway:"away",team:{id:"2",displayName:"Away Team"}}
  ]}]};
const historical={
  "1":[event(101,"2026-09-20",1,9),event(102,"2026-09-27",1,8)],
  "2":[event(201,"2026-09-22",2,7),event(202,"2026-09-29",2,6)],
  "9":[],"8":[],"7":[],"6":[]
};
function box(id){
  return {boxscore:{players:[
    {team:{id:String(id>=200?"2":"1")},statistics:[
      {name:"receiving",labels:["REC","YDS"],athletes:[
        {athlete:{id:"athlete"+id,displayName:"WR "+id,
          position:{abbreviation:"WR"}},stats:["5","72"]}
      ]}
    ]},
    {team:{id:String(id>=200?"7":"9")},statistics:[]}
  ]}};
}
test("one-team focused scan returns only home players without inventing away team records",async()=>{
  const old=globalThis.fetch;
  let requests=0;
  globalThis.fetch=async url=>{
    requests++;
    let payload;
    const u=String(url);
    if(u.includes("/scoreboard?"))payload={events:[scheduled]};
    else if(u.includes("/teams/")&&u.includes("/schedule?")){
      const id=String(u.match(/\/teams\/(\d+)\//)[1]);
      payload={events:historical[id]||[]};
    }else if(u.includes("/summary?event=")){
      const id=Number(u.match(/event=(\d+)/)[1]);
      payload=box(id);
    }else throw Error("Unexpected source "+u);
    return new Response(JSON.stringify(payload),{headers:{"content-type":"application/json"}});
  };
  try{
    const url="https://test.pages.dev/api/scan?sport=nfl&date=2026-10-08"+
      "&gameId=123456789&historySeason=current&mode=both";
    const home=await onRequestGet({request:new Request(url+"&focusTeam=home")});
    assert.equal(home.status,200);
    const a=await home.json();
    assert.equal(a.focusTeam,"home");
    assert.equal(a.seasonBatch.teams.length,2);
    assert.ok(a.seasonBatch.records["1"].length>0);
    assert.equal(a.seasonBatch.records["2"],undefined);
    const away=await onRequestGet({request:new Request(url+"&focusTeam=away")});
    assert.equal(away.status,200);
    const b=await away.json();
    assert.equal(b.focusTeam,"away");
    assert.ok(b.seasonBatch.records["2"].length>0);
    assert.equal(b.seasonBatch.records["1"],undefined);
    assert.ok(requests<45,"Two focused team scans should stay under overall free-tier external request budget in minimal fixtures.");
    assert.equal(a.season,2026);
    assert.equal(b.season,2026);
  }finally{globalThis.fetch=old;}
});

test("invalid focusTeam is rejected without requesting ESPN",async()=>{
  const response=await onRequestGet({request:new Request(
    "https://test.pages.dev/api/scan?sport=nfl&date=2026-10-08&gameId=123456789&focusTeam=invalid"
  )});
  assert.equal(response.status,400);
  assert.match((await response.json()).error,/focusTeam/);
});
