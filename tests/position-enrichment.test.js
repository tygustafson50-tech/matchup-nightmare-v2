import test from "node:test";
import assert from "node:assert/strict";
import {
  extractBoxscore,rosterPositionIndex,attachRosterPositions,
  positionAllowedByGame,buildPositionProfile
} from "../lib/auto-scan.js";
import {onRequestGet} from "../functions/api/scan.js";

function noPositionSummary(idA="1",idB="2",yardsA=70,yardsB=40) {
  const club=(id,player,value)=>({
    team:{id:String(id),displayName:"Team "+id},
    statistics:[{name:"receiving",labels:["REC","YDS"],athletes:[
      {athlete:{id:String(player),displayName:"Receiver "+player},
        stats:["5",String(value)]}
    ]}]
  });
  return {boxscore:{players:[club(idA,"100"+idA,yardsA),
    club(idB,"100"+idB,yardsB)]}};
}
function roster(teamId,playerIds) {
  return {team:{id:String(teamId)},athletes:[
    {position:"offense",items:playerIds.map(id=>({
      id:String(id),displayName:"Receiver "+id,position:{abbreviation:"WR"}
    }))}
  ]};
}
test("extracts a literal position string from an ESPN boxscore row",()=>{
  const summary=noPositionSummary();
  summary.boxscore.players[0].statistics[0].athletes[0].position="WR";
  const player=extractBoxscore(summary,"nfl","1")[0];
  assert.equal(player.position,"WR");
  assert.equal(player.positionSource,"boxscore");
});
test("reads explicitly labeled athlete positions in nested ESPN roster sections",()=>{
  const positions=rosterPositionIndex(roster("1",["1001"]),"1");
  assert.equal(positions["1"]["1001"],"WR");
});
test("real roster IDs correct missing boxscore positions without changing game stats",()=>{
  const raw=noPositionSummary();
  assert.equal(extractBoxscore(raw,"nfl","1")[0].position,"");
  const hinted=attachRosterPositions(raw,rosterPositionIndex(roster("1",["1001"]),"1"));
  const player=extractBoxscore(hinted,"nfl","1")[0];
  assert.equal(player.position,"WR");
  assert.equal(player.positionSource,"verified-roster");
  assert.equal(player.stats.receivingYards,70);
  assert.equal(extractBoxscore(raw,"nfl","1")[0].position,"");
});
test("defensive profile becomes available when two complete games have verified position data",()=>{
  const s1=attachRosterPositions(noPositionSummary("1","2",80,45),
    rosterPositionIndex(roster("1",["1001"]),"1"));
  const s2=attachRosterPositions(noPositionSummary("1","2",100,30),
    rosterPositionIndex(roster("1",["1001"]),"1"));
  assert.equal(positionAllowedByGame(s1,"nfl","2")["receivingYards|WR"].value,80);
  assert.equal(buildPositionProfile([{id:"a",summary:s1},{id:"b",summary:s2}],
    "nfl","2")["receivingYards|WR"].average,90);
});
test("conflicting roster positions never become false positional totals",()=>{
  const hint=rosterPositionIndex({athletes:[{
    items:[
      {id:"1001",position:"WR"},{id:"1001",position:"TE"}
    ]
  }]},"1");
  assert.equal(hint["1"]["1001"],null);
  const summary=attachRosterPositions(noPositionSummary(),hint);
  assert.equal(extractBoxscore(summary,"nfl","1")[0].position,"");
});
test("unrecognized or missing roles do not get guessed from receiving stats",()=>{
  const raw=noPositionSummary();
  assert.equal(positionAllowedByGame(raw,"nfl","2")["receivingYards|WR"],undefined);
  const n=attachRosterPositions(raw,rosterPositionIndex(roster("1",["999"]),"1"));
  assert.equal(extractBoxscore(n,"nfl","1")[0].position,"");
});
test("selected-game scanner requests real roster positions when original game rows lack them",async()=>{
  const prior=globalThis.fetch;
  const iso=(d)=>d+"T18:00:00Z";
  const matchup=(id,date,a,b,season=2026)=>({
    id:String(id),date:iso(date),season:{year:season},status:{type:{completed:true}},
    competitions:[{competitors:[
      {team:{id:String(a),displayName:"Team "+a},score:"25"},
      {team:{id:String(b),displayName:"Team "+b},score:"20"}
    ]}]
  });
  const selected={id:"123456789",date:iso("2026-10-08"),season:{year:2026},
    competitions:[{competitors:[
      {homeAway:"home",team:{id:"1",displayName:"Home"}},
      {homeAway:"away",team:{id:"2",displayName:"Away"}}
    ]}]};
  const schedules={},boxscores={};
  for(const t of [1,2]){
    schedules[String(t)]=[];
    for(let i=0;i<5;i++){
      const opponent=10*t+i+10,id=100*t+i;
      const ev=matchup(id,"2026-09-"+String(1+i*5).padStart(2,"0"),t,opponent);
      schedules[String(t)].push(ev);
      boxscores[String(id)]=noPositionSummary(String(t),String(opponent),95+i,70);
      schedules[String(opponent)]=[];
      for(let k=0;k<2;k++){
        const old=matchup(10000+opponent*10+k,
          "2026-08-"+String(2+k*9).padStart(2,"0"),opponent,99);
        schedules[String(opponent)].push(old);
        boxscores[String(old.id)]=noPositionSummary("99",String(opponent),101,17);
      }
    }
  }
  let rosterCalls=0,requests=0;
  globalThis.fetch=async url=>{
    const u=String(url);requests++;
    let data;
    if(u.includes("/scoreboard?"))data={events:[selected]};
    else if(u.includes("/roster?")){
      rosterCalls++;
      const tid=String(u.match(/teams\/(\d+)\/roster/)[1]);
      // Verification is based on actual player ID labels in the mocked roster.
      const ids=[tid==="99"?"10099":"100"+tid];
      data=roster(tid,ids);
    }else if(u.includes("/teams/")&&u.includes("/schedule?")){
      const tid=String(u.match(/teams\/(\d+)\/schedule/)[1]);
      data={events:schedules[tid]||[]};
    }else if(u.includes("/summary?event=")){
      const id=String(u.match(/event=(\d+)/)[1]);
      data=boxscores[id];if(!data)throw Error("Boxscore unavailable "+id);
    }else throw Error("Unexpected source "+u);
    return new Response(JSON.stringify(data),{headers:{"content-type":"application/json"}});
  };
  try{
    const result=await onRequestGet({request:new Request(
      "https://example.pages.dev/api/scan?sport=nfl&date=2026-10-08&gameId=123456789&historySeason=current&mode=both"
    )});
    assert.equal(result.status,200);
    const json=await result.json();
    assert.ok(requests<=46, "free request budget exceeded: "+requests);
    assert.ok(rosterCalls>0,"no roster enrichment requested");
    assert.ok(json.diagnostics.rosterLookupsSucceeded>0);
    const player=json.seasonBatch.records["1"].flatMap(g=>g.players).find(p=>p.id==="1001");
    assert.ok(player,"expected recent player record");
    assert.equal(player.position,"WR");
    assert.equal(player.positionSource,"verified-roster");
  }finally{globalThis.fetch=prior;}
});
