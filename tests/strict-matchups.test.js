import test from "node:test";
import assert from "node:assert/strict";
import {playingTimeEligibility,participationInGame} from "../public/lib/participation.js";
import {extractBoxscore} from "../public/lib/auto-scan.js";
import {combineSeasonBatches} from "../public/lib/three-seasons.js";

const upcoming={id:"123456789",date:"2026-10-11T19:00:00Z",
  home:{id:"1",name:"Home"},away:{id:"2",name:"Away"}};
const teams=[
  {id:"1",name:"Home",targetOpponentId:"2"},
  {id:"2",name:"Away",targetOpponentId:"1"}
];
const athlete=(yards,share=0.75)=>({
  id:"11",name:"Starter",position:"WR",
  playingTime:{snapShare:share,starter:true},
  stats:{receivingYards:yards}
});
function season(year,{recentMiss=false,slow=false,missingDefense=false}={}){
  const records={"1":[],"2":[]};
  const defenseProfiles={};
  if(year===2026)defenseProfiles["2"]={
    target:{"receivingYards|WR":{average:100,games:5,metricLabel:"WR receiving yards allowed/game"}}
  };
  const count=year===2026?5:year===2025?4:0;
  for(let i=0;i<count;i++){
    const id=year+"-"+i,opp="opp-"+id;
    const value=year===2026?(recentMiss&&i===0?0:50):60+i;
    records["1"].push({
      id,date:year+"-09-"+String(2+i*3).padStart(2,"0")+"T12:00:00Z",
      season:year,opponent:"Opponent "+i,opponentId:opp,
      playedTeamId:"1",players:[athlete(value,slow?0.42:0.75)]
    });
    if(!missingDefense||i!==0)defenseProfiles[opp]={
      [id]:{"receivingYards|WR":{average:year===2026?190:103,games:5,metricLabel:"WR receiving yards allowed/game"}}
    };
  }
  return {sport:"nfl",game:upcoming,season:year,selectedSeason:2026,
    isCurrentSeason:year===2026,
    diagnostics:{offenseSchedules:2},
    seasonBatch:{season:year,teams,records,defenseProfiles}};
}

test("NFL and NCAA football require measured >50% snaps, not a starter assumption",()=>{
  const passes=Array.from({length:5},()=>({playingTime:{starter:true,snapShare:0.72}}));
  assert.equal(playingTimeEligibility(passes,"nfl").eligible,true);
  assert.equal(playingTimeEligibility(passes.map(x=>({...x,playingTime:{starter:true}})),"nfl").eligible,false);
  assert.equal(playingTimeEligibility(passes.map(x=>({...x,playingTime:{snapShare:0.49}})),"ncaaf").eligible,false);
  assert.equal(playingTimeEligibility([{playingTime:{snapShare:0.25}},...passes.slice(1)],"nfl").eligible,false);
});

test("Basketball and soccer use official regulation-minute equivalents",()=>{
  const several=minutes=>Array.from({length:5},()=>({playingTime:{minutes}}));
  assert.equal(playingTimeEligibility(several(26),"nba").eligible,true);
  assert.equal(playingTimeEligibility(several(21),"ncaab").eligible,true);
  assert.equal(playingTimeEligibility(several(60),"soccer").eligible,true);
  assert.equal(playingTimeEligibility(several(15),"nba").eligible,false);
  assert.equal(playingTimeEligibility(several(40),"soccer").eligible,false);
});

test("MLB uses confirmed lineup starts or pitcher majority of regulation outs",()=>{
  assert.equal(participationInGame({playingTime:{role:"batting",starter:true}},"mlb"),1);
  assert.equal(participationInGame({playingTime:{role:"batting",starter:null}},"mlb"),null);
  assert.ok(participationInGame({playingTime:{role:"pitching",pitchingOuts:18}},"mlb")>0.5);
  assert.equal(playingTimeEligibility(Array.from({length:3},()=>({playingTime:{
    role:"pitching",pitchingOuts:9}})),"mlb").eligible,false);
});

test("extractBoxscore retains verified percentage/minutes instead of inferring playing time",()=>{
  const summary={boxscore:{players:[{team:{id:"1"},statistics:[{
    name:"receiving",labels:["REC","YDS","SNAP%"],athletes:[{
      starter:true,athlete:{id:"11",displayName:"Starter",position:{abbreviation:"WR"}},
      stats:["6","78","72%"]
    }]
  }]}]}};
  const p=extractBoxscore(summary,"nfl","1")[0];
  assert.equal(p.playingTime.snapShare,0.72);
  assert.equal(p.playingTime.starter,true);
});

test("strict mode returns only verified five-for-five AND four-for-four cards",()=>{
  const out=combineSeasonBatches([season(2026),season(2025),season(2024)],
    {sport:"nfl",window:3,strict:true});
  const p=out.results.find(p=>p.playerId==="11"&&p.stat==="receivingYards");
  assert.ok(p,"Expected a fully qualified player");
  assert.equal(p.recentHits,5);
  assert.equal(p.recentSample,5);
  assert.equal(p.similarHits,4);
  assert.equal(p.similarSample,4);
  assert.equal(p.isFullyQualified,true);
  assert.equal(p.playingTimeEligibility.eligible,true);
  assert.ok(p.similarGames.every(g=>[2026,2025,2024].includes(g.season)));
});

test("strict mode rejects an OVER that missed in recent five",()=>{
  const out=combineSeasonBatches([season(2026,{recentMiss:true}),season(2025),season(2024)],
    {sport:"nfl",window:3,strict:true});
  assert.equal(out.results.length,0);
});

test("strict mode rejects missing comparable-defense records",()=>{
  const out=combineSeasonBatches([season(2026),season(2025,{missingDefense:true}),season(2024)],
    {sport:"nfl",window:3,strict:true});
  assert.equal(out.results.length,0);
});

test("strict mode rejects low-snaps and unknown-snap starters",()=>{
  const low=combineSeasonBatches([season(2026,{slow:true}),season(2025),season(2024)],
    {sport:"nfl",window:3,strict:true});
  assert.equal(low.results.length,0);
  const unknown=season(2026);
  for(const row of unknown.seasonBatch.records["1"])
    for(const player of row.players)player.playingTime={starter:true};
  const out=combineSeasonBatches([unknown,season(2025),season(2024)],
    {sport:"nfl",window:3,strict:true});
  assert.equal(out.results.length,0);
  assert.ok(out.notes.some(n=>n.includes("50%")));
});
