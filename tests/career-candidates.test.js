import test from "node:test";
import assert from "node:assert/strict";
import {eligibleCareerPlayers} from "../public/lib/career-candidates.js";

test("player candidate prioritization uses only current season appearances",()=>{
  const event=(id,athletes)=>({
    id,date:"2026-09-"+id+"T19:00:00Z",season:2026,
    players:athletes.map(([pid,pos,value])=>({
      id:String(pid),name:"Player "+pid,position:pos,
      stats:{receivingYards:value}
    }))
  });
  const current={
    seasonBatch:{
      teams:[{id:"1",name:"Team One"},{id:"2",name:"Team Two"}],
      records:{
        "1":[event("01",[[111,"WR",35],[112,"WR",3],[113,"WR",55]]),
          event("08",[[111,"WR",40],[113,"WR",65]])],
        "2":[event("01",[[221,"WR",60]])]
      }
    }
  };
  const out=eligibleCareerPlayers(current,"nfl",1);
  assert.equal(out.total,3);
  assert.equal(out.prioritized.length,2);
  assert.equal(out.remaining.length,1);
  assert.equal(out.prioritized[0].playerId,"111");
  assert.equal(out.prioritized[1].playerId,"221");
  assert.equal(out.remaining[0].playerId,"113");
});

test("players without verified stat or position aren't booked for paid/free requests",()=>{
  const input={seasonBatch:{teams:[{id:"1"}],records:{
    "1":[{id:"game",date:"2026-09-01T19:00:00Z",players:[
      {id:"111",name:"Mystery",position:"",stats:{receivingYards:999}},
      {id:"112",name:"WR",position:"WR",stats:{receivingYards:30}},
      {id:"113",name:"Invalid",position:"WR",stats:{}}
    ]}]
  }}};
  assert.deepEqual(eligibleCareerPlayers(input,"nfl").prioritized.map(x=>x.playerId),["112"]);
});

test("zero candidate cap yields expanded list without fabricating extra players",()=>{
  const input={seasonBatch:{teams:[{id:"5"}],records:{
    "5":[{id:"g",date:"2026-09-01T19:00:00Z",players:[
      {id:"9999",name:"PG",position:"PG",stats:{points:17}}
    ]}]
  }}};
  const out=eligibleCareerPlayers(input,"nba",0);
  assert.equal(out.total,1);
  assert.equal(out.prioritized.length,0);
  assert.equal(out.remaining.length,1);
});
