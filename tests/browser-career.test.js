import test from "node:test";
import assert from "node:assert/strict";
import {createEspnSourceClient} from "../public/lib/season-source.js";
import {loadCareerFromEspn} from "../public/lib/career-source.js";

const game={id:"123456789",date:"2026-10-08T19:00:00Z"};
const player={playerId:"77777",teamId:"1",name:"WR moved teams"};
function summary(a,b,date,id,yards=90){
  const club=(teamId,athleteId,yards)=>({
    team:{id:String(teamId),displayName:"Club "+teamId},
    statistics:[{name:"receiving",labels:["REC","YDS"],athletes:[{
      athlete:{id:String(athleteId),displayName:"Receiver "+athleteId,
        position:{abbreviation:"WR"}},stats:["4",String(yards)]
    }]}]
  });
  return {
    header:{events:[{id:String(id),date,season:{year:2025}}]},
    boxscore:{players:[club(a,77777,yards),club(b,99999,20)]}
  };
}
function mockProvider(){
  let count=0;
  const old=summary(88,44,"2025-09-20T19:00:00Z","401000001",92);
  const prev1=summary(99,44,"2025-08-25T19:00:00Z","401000010",75);
  const prev2=summary(99,44,"2025-08-30T19:00:00Z","401000011",83);
  // The historical defense conceded WR receiving yards against team 99.
  for(const e of [prev1,prev2]){
    e.boxscore.players[0].statistics[0].athletes[0].athlete.id="99123";
  }
  const events=[{
    id:"401000010",date:"2025-08-25T19:00:00Z",
    season:{year:2025},status:{type:{completed:true}},
    competitions:[{competitors:[{team:{id:"44"}},{team:{id:"99"}}]}]
  },{
    id:"401000011",date:"2025-08-30T19:00:00Z",
    season:{year:2025},status:{type:{completed:true}},
    competitions:[{competitors:[{team:{id:"44"}},{team:{id:"99"}}]}]
  }];
  const request=async url=>{
    count++;
    const q=new URL(url,"https://example.pages.dev").searchParams;
    const kind=q.get("kind");
    let data;
    if(kind==="gamelog"){
      data={events:{"401000001":{
        id:"401000001",date:"2025-09-20T19:00:00Z"}}};
    }else if(kind==="summary"){
      data={"401000001":old,"401000010":prev1,"401000011":prev2}[q.get("gameId")];
      if(!data)throw Error("Unexpected summary "+q.get("gameId"));
    }else if(kind==="schedule"){
      data={events};
    }else if(kind==="roster")data={athletes:[]};
    else throw Error("Unexpected source "+kind);
    return new Response(JSON.stringify(data),{
      headers:{"content-type":"application/json"}
    });
  };
  return {request,count:()=>count};
}

test("former-franchise career history verifies player old team and opponent from the game boxscore",async()=>{
  const mock=mockProvider();
  const client=createEspnSourceClient({request:mock.request});
  const result=await loadCareerFromEspn({
    client,sport:"nfl",game,player,season:2025,knownIds:[]
  });
  assert.equal(result.careerBatch.records.length,1);
  assert.equal(result.careerBatch.records[0].playedTeamId,"88");
  assert.equal(result.careerBatch.records[0].opponentId,"44");
  assert.equal(result.careerBatch.records[0].players[0].stats.receivingYards,92);
  assert.equal(result.diagnostics.verifiedAppearances,1);
  assert.equal(result.careerBatch.defenseProfiles["44"]["401000001"]["receivingYards|WR"].average,79);
  assert.equal(result.careerBatch.sourceStatus,"partial");
});

test("known team game IDs are skipped without getting mislabeled as old-team history",async()=>{
  const mock=mockProvider();
  const client=createEspnSourceClient({request:mock.request});
  const result=await loadCareerFromEspn({
    client,sport:"nfl",game,player,season:2025,knownIds:["401000001"]
  });
  assert.deepEqual(result.careerBatch.records,[]);
  assert.equal(result.diagnostics.knownGamesSkipped,1);
});

test("unavailable career gamelog fails gracefully with an explicit partial-data warning",async()=>{
  const client=createEspnSourceClient({request:async()=>new Response(
    JSON.stringify({error:"ESPN career source unavailable"}),{
      status:502,headers:{"content-type":"application/json"}
    })});
  const result=await loadCareerFromEspn({
    client,sport:"nfl",game,player,season:2025
  });
  assert.equal(result.careerBatch.sourceStatus,"unavailable");
  assert.deepEqual(result.careerBatch.records,[]);
  assert.match(result.warnings.join(" "),/gamelog source unavailable/i);
});
