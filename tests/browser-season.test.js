import test from "node:test";
import assert from "node:assert/strict";
import {createEspnSourceClient,loadSeasonFromEspn,seasonOf}
  from "../public/lib/season-source.js";
import {combineSeasonBatches} from "../public/lib/three-seasons.js";

const selected={
  id:"123456789",date:"2026-10-08T19:00:00Z",season:2026,
  home:{id:"1",name:"Team One"},away:{id:"2",name:"Team Two"}
};
function gameEvent(id,date,a,b,season=2026){
  return {id:String(id),date,season:{year:season},status:{type:{completed:true}},
    competitions:[{competitors:[
      {team:{id:String(a),displayName:"Team "+a}},
      {team:{id:String(b),displayName:"Team "+b}}
    ]}]};
}
function gameSummary(a,b){
  const team=(id,yards)=>({team:{id:String(id),displayName:"Team "+id},
    statistics:[{name:"receiving",labels:["REC","YDS"],athletes:[
      {athlete:{id:String(id)+"77",displayName:"Receiver "+id,
        position:{abbreviation:"WR"}},stats:["6",String(yards)]}
    ]}]});
  return {boxscore:{players:[team(a,85),team(b,65)]}};
}
function fixture(year=2026){
  const schedules={},summaries={};
  const add=(id,date,a,b)=>{
    const ev=gameEvent(id,date,a,b,year);
    schedules[String(a)]??=[];schedules[String(a)].push(ev);
    schedules[String(b)]??=[];schedules[String(b)].push(ev);
    summaries[String(id)]=gameSummary(a,b);
  };
  add(year+"0001",year+"-09-25T19:00:00Z",1,11);
  add(year+"0002",year+"-09-18T19:00:00Z",1,12);
  add(year+"0003",year+"-09-26T19:00:00Z",2,13);
  add(year+"0004",year+"-09-19T19:00:00Z",2,14);
  for(const id of [11,12,13,14]){
    add(year+String(id).padStart(2,"0")+"05",
      year+"-09-05T19:00:00Z",id,100+id);
    add(year+String(id).padStart(2,"0")+"10",
      year+"-09-10T19:00:00Z",id,100+id);
  }
  return {schedules,summaries};
}
function simulatedSource(years=[2026]){
  const data=Object.fromEntries(years.map(y=>[y,fixture(y)]));
  const calls=[];
  const request=async url=>{
    const parsed=new URL(url,"https://example.pages.dev");
    const q=parsed.searchParams,kind=q.get("kind"),season=Number(q.get("season"));
    const id=q.get("teamId")||q.get("gameId");
    calls.push({kind,season,id,url});
    let payload;
    if(kind==="schedule")payload={events:data[season]?.schedules[id]||[]};
    else if(kind==="summary"){
      payload=Object.values(data).map(x=>x.summaries[id]).find(Boolean);
      if(!payload)throw Error("Unmocked summary "+id);
    }else if(kind==="roster")payload={athletes:[]};
    else throw Error("Unexpected source kind "+kind);
    return new Response(JSON.stringify(payload),{
      headers:{"content-type":"application/json"}
    });
  };
  return {request,calls};
}

test("ESPN season inference honors league dates without borrowing older years",()=>{
  assert.equal(seasonOf(selected,"nfl"),2026);
  assert.equal(seasonOf({date:"2026-02-04T19:00:00Z"},"nfl"),2025);
  assert.equal(seasonOf({date:"2025-12-08T19:00:00Z"},"nba"),2026);
});

test("browser aggregator retrieves real completed game IDs and raw player results",async()=>{
  const mock=simulatedSource();
  const client=createEspnSourceClient({request:mock.request,concurrency:3});
  const result=await loadSeasonFromEspn({
    client,sport:"nfl",game:selected,season:"current"
  });
  assert.equal(result.season,2026);
  assert.equal(result.selectedSeason,2026);
  assert.deepEqual(result.seasonBatch.teams.map(x=>x.id),["1","2"]);
  assert.equal(result.seasonBatch.records["1"].length,2);
  assert.equal(result.seasonBatch.records["2"].length,2);
  assert.equal(result.seasonBatch.records["1"][0].id,"20260001");
  assert.equal(result.seasonBatch.records["1"][0].players[0].stats.receivingYards,85);
  assert.equal(result.diagnostics.offenseBoxscores,4);
  assert.ok(result.diagnostics.defenseProfiles>0);
});

test("ESPN source calls are deduplicated and limited to three simultaneous requests",async()=>{
  const mock=simulatedSource();let pending=0,maxConcurrent=0;
  const request=async url=>{
    pending++;maxConcurrent=Math.max(maxConcurrent,pending);
    try{
      await Promise.resolve();return await mock.request(url);
    }finally{pending--;}
  };
  const client=createEspnSourceClient({request,concurrency:3});
  await Promise.all([
    loadSeasonFromEspn({client,sport:"nfl",game:selected}),
    loadSeasonFromEspn({client,sport:"nfl",game:selected})
  ]);
  assert.ok(maxConcurrent<=3);
  const ids=mock.calls.map(x=>x.url);
  assert.equal(new Set(ids).size,ids.length);
});

test("previous-season player records never appear in the current-season Last 5",async()=>{
  const mock=simulatedSource([2026,2025,2024]);
  const client=createEspnSourceClient({request:mock.request,concurrency:3});
  const responses=await Promise.all(["current",2025,2024].map(season=>
    loadSeasonFromEspn({client,sport:"nfl",game:selected,season})));
  const all=combineSeasonBatches(responses,{sport:"nfl",window:3,mode:"both"});
  assert.ok(all.results.length>0,"Player cards should exist after fetching summaries");
  assert.ok(all.results.every(p=>p.history.every(g=>g.season===2026)));
  assert.ok(all.results.some(p=>p.careerSampleSeasons.includes(2025)));
});

test("an unavailable ESPN schedule fails honestly instead of inventing a zero-pick scan",async()=>{
  const client=createEspnSourceClient({request:async()=>new Response(
    JSON.stringify({error:"ESPN schedule source unavailable",details:"provider 503"}),{
      status:502,headers:{"content-type":"application/json"}
    })});
  await assert.rejects(
    loadSeasonFromEspn({client,sport:"nfl",game:selected}),
    /ESPN schedule source unavailable/
  );
});

test("missing player boxscores do not become recorded zeroes",async()=>{
  const mock=simulatedSource();
  const request=async url=>{
    if(String(url).includes("kind=summary"))
      return new Response(JSON.stringify({error:"No boxscore"}),{
        status:502,headers:{"content-type":"application/json"}
      });
    return mock.request(url);
  };
  const client=createEspnSourceClient({request});
  const result=await loadSeasonFromEspn({client,sport:"nfl",game:selected});
  assert.deepEqual(result.seasonBatch.records["1"],[]);
  assert.ok(result.diagnostics.missingOffenseBoxscores>0);
  assert.match(result.notes.join(" "),/boxscore/i);
});
