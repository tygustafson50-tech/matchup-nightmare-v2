import test from "node:test";
import assert from "node:assert/strict";
import {parseCareerEventRefs,seasonFromDate,athleteCareerAppearance} from "../lib/career-history.js";
import {onRequestGet} from "../functions/api/career.js";

test("career gamelog discovers matches across team moves without duplicates",()=>{
  const raw={events:{
    "401100001":{gameDate:"2025-09-01T19:00:00Z",opponent:{displayName:"Former Rival"}},
    "401100002":{date:"2025-09-08T19:00:00Z",opponent:{displayName:"Other Rival"}},
    "401100003":{date:"2025-10-20T19:00:00Z",season:{year:2026}},
    "notAnId":{date:"2025-09-11T19:00:00Z"}
  }};
  assert.deepEqual(parseCareerEventRefs(raw,2025,"2026-10-08T19:00:00Z").map(x=>x.id),
    ["401100002","401100001"]);
  assert.equal(parseCareerEventRefs(raw,2025,"2025-09-05T19:00:00Z").length,1);
});

test("career season attribution handles football and basketball boundaries",()=>{
  assert.equal(seasonFromDate("nfl","2026-02-05T01:00:00Z"),2025);
  assert.equal(seasonFromDate("ncaab","2025-10-08T01:00:00Z"),2026);
  assert.equal(seasonFromDate("nba","2025-02-08T01:00:00Z"),2025);
  assert.equal(seasonFromDate("mlb","2025-09-11T01:00:00Z"),2025);
  assert.equal(seasonFromDate("soccer","2026-02-11T01:00:00Z"),2025);
});

function box(eventId,year,oldTeamId,opponentId,playerId,playerYards=80){
  const club=(id,athleteId,yards)=>({
    team:{id:String(id),displayName:"Historical Team "+id},
    statistics:[{name:"receiving",labels:["REC","YDS"],athletes:[
      {athlete:{id:String(athleteId),displayName:"Test Receiver",position:{abbreviation:"WR"}},
        stats:["6",String(yards)]}
    ]}]
  });
  return {
    header:{events:[{id:String(eventId),date:year+"-09-12T19:00:00Z",season:{year:Number(year)}}]},
    boxscore:{players:[club(oldTeamId,playerId,playerYards),club(opponentId,9999,25)]}
  };
}
test("career history uses the player's actual old team not their current roster",()=>{
  const summary=box(401100001,2025,11,22,77777,92);
  const found=athleteCareerAppearance(summary,"nfl","77777","401100001",2025);
  assert.equal(found.playedTeamId,"11");
  assert.equal(found.opponentId,"22");
  assert.equal(found.playedTeamName,"Historical Team 11");
  assert.equal(found.players[0].stats.receivingYards,92);
  assert.equal(athleteCareerAppearance(summary,"nfl","invalid","401100001",2025),null);
  assert.equal(athleteCareerAppearance(summary,"nfl","77777","401100001",2024),null);
});

test("career endpoint rejects games, IDs and seasons outside two previous seasons",async()=>{
  const wrong=await onRequestGet({request:new Request(
    "https://example.pages.dev/api/career?sport=nfl&date=2026-10-08&gameId=nope&playerId=77777&season=2025"
  )});
  assert.equal(wrong.status,400);
});

test("career endpoint loads player appearances from an earlier franchise and their defense",async()=>{
  const old=globalThis.fetch;
  const kickoff="2026-10-08T19:00:00Z";
  const finished=(id,date,first,second)=>({
    id:String(id),date,season:{year:2025},
    status:{type:{completed:true}},competitions:[{competitors:[
      {team:{id:String(first),displayName:"Team "+first},score:"25"},
      {team:{id:String(second),displayName:"Team "+second},score:"20"}
    ]}]
  });
  const gamelog={events:{
    "401100001":{id:"401100001",gameDate:"2025-09-12T19:00:00Z"},
    "401100002":{id:"401100002",gameDate:"2025-09-20T19:00:00Z"}
  }};
  const matchups={
    "401100001":box(401100001,2025,11,22,77777,92),
    "401100002":box(401100002,2025,33,44,77777,100)
  };
  const past=(id,defense,opp)=>({
    ...box(id,2025,opp,defense,12345,95),
    header:{events:[{id:String(id),date:"2025-08-18T19:00:00Z",season:{year:2025}}]}
  });
  for(const [defense,base] of [[22,5000],[44,6000]]){
    for(const i of [1,2])matchups[String(base+i)]=past(base+i,defense,999);
  }
  let calls=0;
  globalThis.fetch=async url=>{
    calls++;
    const u=String(url);let result;
    if(u.includes("/scoreboard?"))result={events:[{
      id:"123456789",date:kickoff,season:{year:2026}
    }]};
    else if(u.includes("/athletes/77777/gamelog"))result=gamelog;
    else if(u.includes("/teams/22/schedule"))result={events:[
      finished(5001,"2025-08-18T19:00:00Z",22,999),
      finished(5002,"2025-08-25T19:00:00Z",22,999)
    ]};
    else if(u.includes("/teams/44/schedule"))result={events:[
      finished(6001,"2025-08-18T19:00:00Z",44,999),
      finished(6002,"2025-08-25T19:00:00Z",44,999)
    ]};
    else if(u.includes("/summary?event="))result=matchups[u.match(/event=(\d+)/)[1]];
    if(!result)throw Error("Unexpected mocked call "+u);
    return new Response(JSON.stringify(result),{headers:{"content-type":"application/json"}});
  };
  try{
    const response=await onRequestGet({request:new Request(
      "https://example.pages.dev/api/career?sport=nfl&date=2026-10-08&gameId=123456789&playerId=77777&season=2025"
    )});
    assert.equal(response.status,200);
    const data=await response.json();
    assert.equal(data.careerBatch.records.length,2);
    assert.deepEqual(data.careerBatch.records.map(g=>g.playedTeamId),["33","11"]);
    assert.deepEqual(data.careerBatch.records.map(g=>g.opponentId),["44","22"]);
    assert.ok(calls<=44);
    assert.equal(data.diagnostics.verifiedAppearances,2);
    assert.ok(data.careerBatch.defenseProfiles["22"]["401100001"]);
  }finally{globalThis.fetch=old;}
});
