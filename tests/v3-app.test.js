import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {makeEvidenceClient,completedTeamGames,playersFromBoxscore,
  concededAgainstPosition} from "../public/lib/evidence-client-v3.js";
import {supportsMarket,positionGroup,resultAtLine} from "../public/lib/research-v3.js";

const app=readFileSync(new URL("../public/app.js",import.meta.url),"utf8");
const html=readFileSync(new URL("../public/index.html",import.meta.url),"utf8");

test("V3 retains six sport navigation, 16-game selection and black/gold stylesheet",()=>{
  for(const sport of ["nfl","nba","ncaaf","ncaab","mlb","soccer"])
    assert.match(app,new RegExp("\\b"+sport+":"));
  assert.match(app,/selected.size<16/);
  assert.match(html,/styles\.css/);
  assert.match(html,/MATCHUP NIGHTMARE/);
  assert.match(html,/filterMarket/);
  assert.doesNotMatch(html,/Advanced · manual player research/);
});
test("V3 never imports or invokes legacy model, historical alt-line maker or manual predictor",()=>{
  for(const name of ["buildMatchupCards","scanTrends","chooseHistoricalAltLine",
    "eligibleCareerPlayers","combineSeasonBatches","parseLogs","createEspnSourceClient"])
    assert.equal(app.includes(name),false,name);
  assert.match(app,/\/api\/lines/);
  assert.match(app,/loadVerifiedEvidence/);
  assert.match(app,/analyzeVerifiedProp/);
  assert.match(app,/No verified PropLine lines/);
  assert.match(app,/old quotes were cleared/);
});
test("all sport-specific positions and markets are kept separate",()=>{
  const cases=[
    ["nfl","QB","passAttempts"],["nfl","WR","targets"],
    ["ncaaf","TE","receptions"],["nba","PG","assists"],
    ["nba","C","blocks"],["ncaab","PF","rebounds"],
    ["mlb","P","pitcherKs"],["mlb","DH","hits"],
    ["soccer","FW","shotsOnTarget"]
  ];
  for(const [sport,position,stat] of cases)
    assert.equal(supportsMarket(sport,position,stat),true,sport+" "+position+" "+stat);
  assert.equal(supportsMarket("mlb","DH","pitcherKs"),false);
  assert.equal(supportsMarket("nfl","QB","points"),false);
  assert.equal(positionGroup("nba","C"),"C");
});
test("source game schedule excludes completed future fixtures",()=>{
  const entries=[{id:"11111",date:"2026-09-02T00:00:00Z",
    season:{year:2026},status:{type:{completed:true}},
    competitions:[{competitors:[
      {team:{id:"1"}},{team:{id:"2",displayName:"Visitor"}}]}]},
    {id:"22222",date:"2026-11-02T00:00:00Z",
      season:{year:2026},status:{type:{completed:true}},
      competitions:[{competitors:[{team:{id:"1"}},{team:{id:"2"}}]}]}];
  assert.deepEqual(completedTeamGames({events:entries},"1",
    "2026-10-10T00:00:00Z",2026).map(g=>g.id),["11111"]);
});
test("MLB pitcher comparison uses actual opposing lineup strikeouts, never opposing pitcher stats",()=>{
  const summary={boxscore:{players:[
    {team:{id:"1"},statistics:[{name:"batting",labels:["AB","H","SO"],
      athletes:[{athlete:{id:"11",displayName:"Hitter",position:{abbreviation:"CF"}},
        stats:["5","2","3"]}]}]},
    {team:{id:"2"},statistics:[{name:"pitching",labels:["IP","K"],
      athletes:[{athlete:{id:"22",displayName:"Pitcher",position:{abbreviation:"P"}},
        stats:["6.0","12"]}]}]}
  ]}};
  const got=concededAgainstPosition(summary,{sport:"mlb",defenseId:"2",
    role:"P",stat:"pitcherKs"});
  assert.deepEqual(got,{allowed:3,volume:5});
  assert.equal(playersFromBoxscore(summary,"mlb","1")[0].stats.battingStrikeouts,3);
  assert.equal(concededAgainstPosition(summary,{sport:"mlb",defenseId:"2",
    role:"P",stat:"pitchingOuts"}),null);
});
test("unavailable verified stat never becomes zero",()=>{
  assert.equal(resultAtLine(null,2.5),"UNVERIFIED");
  const summary={boxscore:{players:[{team:{id:"1"},statistics:[
    {name:"passing",labels:["YDS"],athletes:[
      {athlete:{id:"12",displayName:"QB"},stats:["N/A"]}]}]}]}};
  assert.deepEqual(playersFromBoxscore(summary,"nfl","1"),[]);
});
test("ESPN client shares identical event requests and reports provider errors",async()=>{
  let calls=0;
  const client=makeEvidenceClient({fetcher:async()=>{
    calls++;return new Response(JSON.stringify({events:[]}),{
      status:200,headers:{"content-type":"application/json"}});
  }});
  const params={sport:"nfl",kind:"schedule",teamId:"1",season:"2026"};
  const [a,b]=await Promise.all([client.call(params),client.call(params)]);
  assert.deepEqual(a,b);
  assert.equal(calls,1);
});

test("official PropLine shortcut opens externally without implying live projections",()=>{
  assert.match(html,/href="https:\/\/prop-line\.com\/pricing"/);
  assert.match(html,/target="_blank"/);
  assert.match(html,/rel="noopener noreferrer"/);
  assert.match(html,/Get your own API key/);
});
