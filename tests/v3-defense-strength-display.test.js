import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {defenseStrength} from "../public/lib/defense-strength.js";
import {renderDefenseBadge,renderUpcomingDefense}
  from "../public/lib/defense-strength-ui.js";
import {renderVerifiedHistory} from "../public/lib/verified-history-ui.js";
import {analyzeVerifiedProp} from "../public/lib/research-v3.js";

const nfl=(teamId,season,passing=9,rushing=22)=>({
  verified:true,teamId:String(teamId),season,
  passing:{rank:passing,yardsPerGame:passing+180},
  rushing:{rank:rushing,yardsPerGame:rushing+85}
});
test("NFL receiving stat always displays PASS defense rank; rushing uses RUSH",()=>{
  const source=nfl(4,2025,7,26);
  const receiving=defenseStrength({sport:"nfl",stat:"receivingYards",position:"WR",profile:source});
  const rushing=defenseStrength({sport:"nfl",stat:"rushingYards",position:"RB",profile:source});
  assert.equal(receiving.lane,"passing");
  assert.equal(receiving.rank,7);
  assert.equal(receiving.rankTier,"Top 8");
  assert.equal(rushing.lane,"rushing");
  assert.equal(rushing.rank,26);
  assert.equal(rushing.rankTier,"25–32");
  assert.match(renderDefenseBadge(receiving),/PASS D #7\/32/);
  assert.match(renderDefenseBadge(rushing),/RUSH D #26\/32/);
});
test("upcoming opponent shows both authentic pass and rush defense ranks with source caveat",()=>{
  const snapshot=defenseStrength({sport:"nfl",stat:"receivingYards",profile:nfl(1,2026,12,5)});
  const html=renderUpcomingDefense(snapshot,{opponent:"<Falcons>",sport:"nfl"});
  assert.match(html,/CURRENT MATCHUP/);
  assert.match(html,/&lt;Falcons&gt;/);
  assert.match(html,/PASS D #12\/32/);
  assert.match(html,/PASS #12\/32/);
  assert.match(html,/RUSH #5\/32/);
  assert.match(html,/season-to-date/);
  assert.match(html,/Historical game ranks are season aggregates/);
  assert.doesNotMatch(html,/<Falcons>/);
});
test("NFL missing rank does not guess a grade, rank, or fallback value",()=>{
  assert.equal(defenseStrength({sport:"nfl",stat:"receivingYards",
    profile:{...nfl(4,2026),passing:null}}),null);
  const html=renderDefenseBadge(null);
  assert.match(html,/Defense not verified/);
  assert.doesNotMatch(html,/#\d+\/32/);
});
test("college basketball, NBA, MLB, soccer and NCAA football use actual role/stat allowance, NOT invented league rank",()=>{
  for(const [sport,stat,position,role,allowed] of [
    ["nba","points","PG","PG",24.7],
    ["ncaab","rebounds","G","G",10.2],
    ["ncaaf","receivingYards","WR","WR",135.2],
    ["mlb","hits","DH","BATTER",9.3],
    ["soccer","shots","FW","F",7.7]
  ]){
    const profile={verified:true,sport,position:role,stat,season:2026,
      metrics:{allowed,volume:12},verifiedGames:4};
    const snap=defenseStrength({sport,stat,position,profile});
    assert.equal(snap.allowedPerGame,allowed,sport);
    const html=renderDefenseBadge(snap);
    assert.match(html,/4 prior ESPN games/);
    assert.match(html,/no league rank/);
    assert.doesNotMatch(html,/#\d+\/32/);
  }
});
test("non-NFL profiles with too few verified games or wrong stat cannot claim strength",()=>{
  const base={verified:true,sport:"nba",position:"PG",stat:"points",
    season:2026,metrics:{allowed:21,volume:12},verifiedGames:4};
  assert.equal(defenseStrength({sport:"nba",stat:"rebounds",position:"PG",profile:base}),null);
  assert.equal(defenseStrength({sport:"nba",stat:"points",position:"PG",
    profile:{...base,verifiedGames:2}}),null);
  assert.equal(defenseStrength({sport:"nba",stat:"points",position:"PG",
    profile:{...base,verified:false}}),null);
});
test("every recent and similar NFL game gets its own corresponding season defensive rank",()=>{
  const offer={id:"source-test",sport:"nfl",source:"PropLine",status:"active",
    player:"Test Athlete",espnPlayerId:"12",position:"WR",team:"Bears",
    opponent:"Rams",stat:"receivingYards",market:"Receiving yards",
    line:49.5,variant:"standard",book:"DraftKings",bookKey:"draftkings",
    quotedAt:"2026-10-11T18:00:00Z",gameDateLocal:"2026-10-12"};
  const games=[0,1,2,3,4,5,6,7].map(i=>({
    id:"test"+i,playerId:"12",sport:"nfl",stat:"receivingYards",
    opponent:"Team "+i,opponentId:String(20+i),season:i<4?2026:i<6?2025:2024,
    date:(i<4?"2026":i<6?"2025":"2024")+"-09-"+String(i+1).padStart(2,"0")+"T19:00:00Z",
    actual:90-i*3,verified:true,source:"ESPN game summary"
  }));
  const profiles=games.map((g,i)=>({...nfl(g.opponentId,g.season,10+i%5,24),gameId:g.id}));
  const result=analyzeVerifiedProp({offer,season:2026,games,defensiveProfiles:profiles,
    upcomingDefense:nfl(99,2026,12,24),
    matchupModel:"nfl-ranks",now:"2026-10-11T20:00:00Z"});
  assert.equal(result.currentDefenseStrength.rank,12);
  assert.equal(result.recent.tracked,4);
  assert.deepEqual(result.recentGames.map(g=>g.defenseStrength?.rank),[13,12,11,10]);
  assert.ok(result.similar.tracked>=3);
  for(const similar of result.similarGames){
    const source=games.find(g=>g.id===similar.id);
    const expected=profiles.find(p=>p.gameId===source.id).passing.rank;
    assert.equal(similar.defenseStrength.rank,expected);
  }
  const recentHtml=renderVerifiedHistory({label:"Recent Matchups",games:result.recentGames,
    line:49.5,market:"Receiving yards"});
  const similarHtml=renderVerifiedHistory({label:"Similar Defenses",games:result.similarGames,
    line:49.5,market:"Receiving yards",similar:true});
  assert.match(recentHtml,/PASS D #13\/32/);
  assert.match(similarHtml,/PASS D #/);
  assert.match(recentHtml,/season aggregate rank/);
  assert.match(similarHtml,/season aggregate rank/);
  assert.match(recentHtml,/4\/4/);
  assert.match(similarHtml,/verified-defense-detail/);
});
test("recent rows display unverified defense without inventing historical strength",()=>{
  const html=renderVerifiedHistory({label:"Recent",line:3.5,market:"Receptions",
    games:[{id:"one",date:"2026-10-01T18:00:00Z",
      opponent:"Real Team",actual:6,defenseStrength:null}]});
  assert.match(html,/Defense not verified/);
  assert.match(html,/1\/1/);
});
test("app wires current matchup strength and shares the badge renderer with both histories",()=>{
  const app=readFileSync(new URL("../public/app.js",import.meta.url),"utf8");
  const engine=readFileSync(new URL("../public/lib/research-v3.js",import.meta.url),"utf8");
  assert.match(app,/renderUpcomingDefense\(c\.currentDefenseStrength/);
  assert.match(app,/historyBlock\("Similar Defenses/);
  assert.match(app,/historyBlock\("Recent Matchups/);
  assert.match(engine,/defenseStrength:snapshotFor\(g\)/);
  assert.match(engine,/currentDefenseStrength/);
});
