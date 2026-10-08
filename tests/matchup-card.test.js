import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {renderGameHistory} from "../public/lib/game-history.js";

const app=readFileSync(new URL("../public/app.js",import.meta.url),"utf8");
const start=app.indexOf("function renderPickCard(p){");
const stop=app.indexOf("function renderAutomaticResults(",start);
assert.ok(start>=0&&stop>start,"Can't find the automatic player-card renderer");
const safe=s=>String(s??"").replace(/[&<>"']/g,c=>({
  "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
}[c]));
const render=new Function("safe","renderGameHistory",
  app.slice(start,stop)+";return renderPickCard;")(safe,renderGameHistory);
const sample={
  player:"Receiver",playerId:"77",headshot:null,teamName:"Home",position:"WR",
  sourceGame:{away:{name:"Away"},home:{name:"Home"}},
  market:"Receiving yards",stat:"receivingYards",line:49.5,
  lineType:"research-only",lineVerified:false,marketSource:"Research",
  recentSeason:2026,recentHits:4,recentSample:5,
  history:[
    {date:"2026-09-28T19:00:00Z",opponent:"DAL",value:68,season:2026},
    {date:"2026-09-21T19:00:00Z",opponent:"GB",value:74,season:2026},
    {date:"2026-09-14T19:00:00Z",opponent:"CHI",value:32,season:2026},
    {date:"2026-09-07T19:00:00Z",opponent:"DET",value:91,season:2026},
    {date:"2026-09-01T19:00:00Z",opponent:"MIN",value:58,season:2026}
  ],
  similarHits:2,similarSample:4,matchedSeasons:[2025,2024],
  similarGames:[
    {date:"2025-11-01T18:00:00Z",opponent:"PHI",value:66,season:2025,
      opponentAllowed:102.5,opponentDefenseGames:3,
      metricLabel:"WR receiving yards allowed/game",
      comparableReason:"102.5 vs upcoming 100.0 WR receiving yards allowed/game (2.5% difference)"},
    {date:"2025-10-14T18:00:00Z",opponent:"ATL",value:44,season:2025,
      opponentAllowed:101,opponentDefenseGames:3,
      metricLabel:"WR receiving yards allowed/game",comparableReason:"1% difference"},
    {date:"2024-11-13T18:00:00Z",opponent:"LAR",value:57,season:2024,
      opponentAllowed:97,opponentDefenseGames:3,
      metricLabel:"WR receiving yards allowed/game",comparableReason:"3% difference"},
    {date:"2024-09-08T18:00:00Z",opponent:"ARI",value:25,season:2024,
      opponentAllowed:100,opponentDefenseGames:3,
      metricLabel:"WR receiving yards allowed/game",comparableReason:"0% difference"}
  ],
  targetDefense:100,targetDefenseGames:3,matchupMetric:"WR receiving yards allowed/game",
  matchupPosition:"WR",reason:"Verified matching positional defenses",
  careerSeasonsVerified:[2025,2024],careerTeamsIncluded:["88"],
  sourceMarketLine:false,coveragePartial:false
};

test("one card shows distinct truthful 4/5 recent and 2/4 matchup percentages",()=>{
  const html=render(sample);
  assert.match(html,/4\/5 · 80%/);
  assert.match(html,/2\/4 · 50%/);
  assert.match(html,/50% MATCHUP/);
  assert.doesNotMatch(html,/100% SIMILAR/);
});

test("matching rows show opponent date, actual stats, selected line, rate, why comparable",()=>{
  const html=render(sample);
  for(const text of ["Sep 28, 2026","Nov 1, 2025","PHI","ARI","49.5",
    "102.5","Why similar:","2.5% difference","OVER","BELOW"])
    assert.ok(html.includes(text),"Missing "+text);
  assert.match(html,/WR receiving yards allowed\/game/);
});

test("stat and position same card template works across all six sports",()=>{
  const sports=[
    ["nfl","WR","Receiving yards"],
    ["nba","PG","Assists"],
    ["ncaaf","RB","Rushing yards"],
    ["ncaab","C","Rebounds"],
    ["mlb","SP","Pitcher strikeouts"],
    ["soccer","FW","Shots"]
  ];
  for(const [sport,position,market] of sports){
    const html=render({...sample,sport,position,market});
    assert.match(html,/Recent 5 Games/);
    assert.match(html,/Last 4 Matchups vs Similar Defenses/);
    assert.match(html,/RESEARCH-ONLY OVER/);
    assert.match(html,/RESEARCH-ONLY OVER/);
  }
});

test("a missing similar-defense sample is displayed as unavailable, not 100%",()=>{
  const html=render({...sample,similarGames:[],similarHits:0,similarSample:0,
    reason:"No verified defensive profile."});
  assert.match(html,/No verified similar-defense trend/);
  assert.match(html,/0 of 4 comparable/);
  assert.match(html,/RECENT FORM ONLY/);
  assert.doesNotMatch(html,/100% MATCHUP/);
});

test("quoted labels only appear on cards with verified market data",()=>{
  const research=render({...sample,lineVerified:false,lineType:"research-only"});
  assert.match(research,/not a current PrizePicks\/sportsbook line/i);
  const live=render({...sample,lineVerified:true,lineType:"PrizePicks",
    marketSource:"Verified PrizePicks quote"});
  assert.match(live,/VERIFIED PrizePicks OVER/);
  assert.doesNotMatch(live,/not a current PrizePicks\/sportsbook line/);
});

test("source and player names are HTML-escaped",()=>{
  const html=render({...sample,player:'<img src=x onerror=bad()>',
    teamName:"<script>bad()</script>"});
  assert.match(html,/&lt;img/);
  assert.match(html,/&lt;script&gt;/);
  assert.doesNotMatch(html,/<script>bad/);
});
