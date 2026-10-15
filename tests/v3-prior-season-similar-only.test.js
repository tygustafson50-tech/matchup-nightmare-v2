import test from "node:test";
import assert from "node:assert/strict";
import {analyzeVerifiedProp,seasonWindow} from "../public/lib/research-v3.js";
import {deepStatSpec,makeDeepProfile} from "../public/lib/sport-defense-depth.js";

const cases=[
  ["nfl","WR","receivingYards"],
  ["ncaaf","WR","receivingYards"],
  ["nba","PG","points"],
  ["ncaab","G","points"],
  ["mlb","DH","hits"],
  ["soccer","F","goals"]
];
const rank=(year,teamId,gameId)=>({
  verified:true,teamId:String(teamId),season:year,gameId,
  passing:{rank:11,yardsPerGame:205},
  rushing:{rank:13,yardsPerGame:117}
});
const deep=(sport,role,stat,year,teamId,gameId)=>{
  const spec=deepStatSpec(sport,stat,role);
  const metrics={allowed:8,volume:12};
  const secondaryStats=Object.fromEntries(spec.secondary.map(s=>[s,6]));
  const secondaryGames=Object.fromEntries(spec.secondary.map(s=>[s,5]));
  return makeDeepProfile({sport,role,stat,teamId,gameId,season:year,
    asOf:year+"-08-25T00:00:00Z",metrics,verifiedGames:5,
    secondaryStats,secondaryGames,
    league:sport==="soccer"?"eng.1":null});
};
test("past-3 completed season window excludes the current season explicitly",()=>{
  assert.deepEqual(seasonWindow(2026),[2025,2024,2023]);
  assert.deepEqual(seasonWindow(2027),[2026,2025,2024]);
});
for(const [sport,position,stat] of cases){
  test(sport+": prior seasons only in similar section, while recent five remains current season",()=>{
    const offer={id:"real-quote-1",source:"PropLine",book:"DraftKings",
      bookKey:"draftkings",sport,status:"active",position,stat,
      player:"Verified Player",espnPlayerId:"77",team:"Home",
      opponent:"Away",market:stat,variant:"standard",line:0.5,
      gameDateLocal:"2026-10-24",quotedAt:"2026-10-20T12:00:00Z",
      league:sport==="soccer"?"eng.1":null};
    const data=[
      [2026,"this-year",9,"2026-09-10T19:00:00Z"],
      [2025,"past-one",2,"2025-09-10T19:00:00Z"],
      [2024,"past-two",4,"2024-09-10T19:00:00Z"],
      [2023,"past-three",3,"2023-09-10T19:00:00Z"],
      [2022,"too-old",9,"2022-09-10T19:00:00Z"]
    ];
    const games=data.map(([season,id,actual,date],i)=>({
      id,season,actual,date,sport,stat,playerId:"77",
      opponent:"Opp "+i,opponentId:String(i+31),team:"Home",
      verified:true,source:"ESPN game summary"
    }));
    const profile=(year,id,teamId)=>
      sport==="nfl"?rank(year,teamId,id):
        deep(sport,position,stat,year,teamId,id);
    const pastProfiles=games.map(g=>profile(g.season,g.id,g.opponentId));
    const current=profile(2026,null,"90");
    const result=analyzeVerifiedProp({
      offer,season:2026,games,defensiveProfiles:pastProfiles,
      upcomingDefense:current,upcomingContext:null,
      matchupModel:sport==="nfl"?"nfl-depth":"multi-sport-depth",
      now:"2026-10-20T12:00:00Z"
    });
    assert.ok(result,sport+": valid verified card");
    assert.deepEqual(result.recentGames.map(g=>g.id),["this-year"]);
    assert.equal(result.recent.tracked,1);
    assert.equal(result.similar.tracked,3,sport+": all 3 historical years qualify");
    assert.deepEqual(new Set(result.similarGames.map(g=>Number(g.season))),
      new Set([2025,2024,2023]));
    assert.ok(result.similarGames.every(g=>g.season<2026),
      sport+": no current-season game in similar selection");
    assert.ok(!result.similarGames.some(g=>g.id==="this-year"||g.id==="too-old"));
    assert.equal(result.similar.hits,result.similarGames.filter(g=>g.actual>0.5).length);
  });
}
