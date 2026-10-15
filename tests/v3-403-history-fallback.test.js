import test from "node:test";
import assert from "node:assert/strict";
import {loadVerifiedEvidence} from "../public/lib/evidence-client-v3.js";

const fixture={
  id:"401999999",date:"2026-10-16T23:00:00Z",season:2026,
  home:{id:"1",name:"Example Home"},away:{id:"2",name:"Example Away"}
};
const testCases=[
  ["nfl","WR","receptions","receiving",["REC","YDS","TGTS"],["5","60","7"]],
  ["ncaaf","WR","receptions","receiving",["REC","YDS","TGTS"],["5","60","7"]],
  ["nba","SG","points","scoring",["PTS","REB","AST"],["25","4","6"]],
  ["ncaab","G","points","scoring",["PTS","REB","AST"],["25","4","6"]],
  ["mlb","1B","hits","batting",["AB","H","R"],["5","2","1"]],
  ["soccer","FW","goals",null,[],[]]
];
for(const [sport,position,stat,group,labels,values] of testCases){
  test(sport+" recovers actual last 5 player stats from completed games after ESPN gamelog 403",async()=>{
    const requests=[];
    const athlete={id:"88",displayName:"Example Player",
      position:{abbreviation:position}};
    const schedule={events:Array.from({length:6},(_,i)=>({
      id:String(401800001+i),
      date:"2026-10-"+String(5+i).padStart(2,"0")+"T18:00:00Z",
      season:{year:2026},
      competitions:[{status:{type:{completed:true,state:"post"}},
        competitors:[{team:{id:"1",displayName:"Example Home"}},
          {team:{id:"2",displayName:"Example Away"}}]}]
    }))};
    const summary=id=>{
      const date=schedule.events.find(e=>e.id===id)?.date;
      const box={header:{competitions:[{date}],events:[{season:{year:2026}}]},
        boxscore:{players:[
          {team:{id:"1",displayName:"Example Home"},statistics:[{
            name:group,labels,athletes:[{athlete,stats:values}]
          }]},
          {team:{id:"2",displayName:"Example Away"},statistics:[]}
        ]}};
      if(sport==="soccer")box.rosters=[
        {team:{id:"1",displayName:"Example Home"},roster:[{
          athlete,stats:[{name:"totalGoals",value:1}]
        }]},
        {team:{id:"2",displayName:"Example Away"},roster:[]}
      ];
      return box;
    };
    const client={call:async params=>{
      requests.push(params);
      if(params.kind==="roster")
        return {athletes:[{items:params.teamId==="1"?[athlete]:[]}]};
      if(params.kind==="gamelog")throw Error("ESPN gamelog returned 502 (upstream 403)");
      if(params.kind==="schedule")
        return params.teamId==="1"&&params.season==="2026"
          ?schedule:{events:[]};
      if(params.kind==="summary")return summary(params.gameId);
      if(params.kind==="teamstats")return {results:{opponent:[]}};
      throw Error("Unexpected ESPN endpoint "+params.kind);
    }};
    const result=await loadVerifiedEvidence({client,game:fixture,
      offer:{sport,source:"PropLine",player:"Example Player",stat}});
    assert.ok(result.games.length>=5,sport+" source-derived games");
    assert.ok(result.games.every(x=>x.verified===true&&
      Number.isFinite(x.actual)&&x.playerId==="88"&&x.stat===stat));
    assert.equal(result.games[0].season,2026);
    assert.ok(requests.some(x=>x.kind==="schedule"&&x.teamId==="1"));
    assert.ok(requests.some(x=>x.kind==="summary"));
  });
}
