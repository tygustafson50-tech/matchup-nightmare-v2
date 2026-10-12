import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {makeEvidenceClient,completedTeamGames,playersFromBoxscore,
  concededAgainstPosition,loadVerifiedEvidence} from "../public/lib/evidence-client-v3.js";
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

test("quota fallback is wired into the real scan and quote-refresh paths",()=>{
  assert.match(app,/import \{saveCompletedScan,readLastScan\}/);
  assert.match(app,/if\(response\.status===429\|\|feed\.status==="rate-limited"\)/);
  assert.match(app,/showSavedScan\(\{chosen,day,league,currentSport/);
  assert.match(app,/saveCompletedScan\(\{sport:currentSport,date:day,league/);
  assert.match(app,/LAST SAVED SCAN — NOT LIVE/);
  assert.match(app,/LAST SAVED DRAFTKINGS OVER LINE/);
  assert.match(app,/quotaPaused/);
  assert.match(app,/c\.cachedAt/);
});

test("live MLB ESPN boxscore with no group name resolves hitters and pitchers",()=>{
  const summary={boxscore:{players:[
    {team:{id:"1"},statistics:[
      {labels:["H-AB","AB","R","H","RBI","HR","BB","K","#P","AVG"],
        athletes:[{athlete:{id:"11",displayName:"Real Hitter",
          position:{abbreviation:"LF"}},stats:["2-4","4","1","2","0","0","1","0","12",".300"]}]},
      {labels:["IP","H","R","ER","BB","K","HR","PC-ST","ERA"],
        athletes:[{athlete:{id:"12",displayName:"Real Pitcher",
          position:{abbreviation:"SP"}},stats:["5.2","4","2","2","1","8","0","100-66","2.20"]}]}
    ]},
    {team:{id:"2"},statistics:[]}
  ]}};
  const got=playersFromBoxscore(summary,"mlb","1");
  const hitter=got.find(x=>x.id==="11"),pitcher=got.find(x=>x.id==="12");
  assert.equal(hitter.stats.hits,2);
  assert.equal(hitter.stats.runs,1);
  assert.equal(hitter.stats.atBats,4);
  assert.equal(pitcher.stats.pitcherKs,8);
  assert.equal(pitcher.stats.pitchingOuts,17);
});

test("real NBA generic G/F boxscore roles match verified PG or SG defensive samples",()=>{
  const summary={boxscore:{players:[
    {team:{id:"1"},statistics:[{labels:["MIN","PTS","FG","3PT","FT","REB","AST","TO","STL","BLK","OREB","DREB","PF"],
      athletes:[
        {athlete:{id:"11",displayName:"Guard",position:{abbreviation:"G"}},
          stats:["25","23","9-18","2-5","3-3","3","7","2","1","0","0","3","2"]},
        {athlete:{id:"12",displayName:"Forward",position:{abbreviation:"F"}},
          stats:["29","15","5-12","1-3","4-5","7","3","1","0","1","2","5","1"]}
      ]}]},
    {team:{id:"2"},statistics:[]}
  ]}};
  const guards=concededAgainstPosition(summary,{sport:"nba",defenseId:"2",
    role:"PG",stat:"points"});
  assert.deepEqual(guards,{allowed:23,volume:18});
  const points=playersFromBoxscore(summary,"nba","1");
  assert.equal(points.find(x=>x.id==="11").stats.assists,7);
  assert.equal(points.find(x=>x.id==="12").stats.rebounds,7);
});

test("ESPN soccer roster records contain verifiable per-athlete goals, assists and shots",()=>{
  const soccer={rosters:[
    {team:{id:"1"},roster:[{athlete:{id:"11",displayName:"Test Attacker"},
      position:{abbreviation:"F"},stats:[
        {name:"totalGoals",value:1},{name:"goalAssists",value:2},
        {name:"totalShots",value:5},{name:"shotsOnTarget",value:3},
        {name:"foulsCommitted",value:1},{name:"totalTackles",value:2}]}]},
    {team:{id:"2"},roster:[{athlete:{id:"22",displayName:"Defending Attacker"},
      position:{abbreviation:"F"},stats:[
        {name:"goalAssists",value:0},{name:"totalShots",value:4}]}]}
  ]};
  const player=playersFromBoxscore(soccer,"soccer","1")[0];
  assert.equal(player.stats.goals,1);
  assert.equal(player.stats.assists,2);
  assert.equal(player.stats.shots,5);
  assert.equal(player.stats.shotsOnTarget,3);
  assert.equal(player.stats.tackles,2);
  assert.equal(player.stats.fouls,1);
  assert.equal(concededAgainstPosition(soccer,{sport:"soccer",
    defenseId:"1",role:"F",stat:"assists"}).allowed,0);
  assert.equal(concededAgainstPosition(soccer,{sport:"soccer",
    defenseId:"1",role:"F",stat:"assists"}).volume,4);
});

test("MLS March matches stay within the calendar year's verified three-season sample",async()=>{
  const offer={source:"PropLine",sport:"soccer",player:"Test Attacker",
    stat:"assists",position:"F",book:"DraftKings"};
  const game={id:"99999",date:"2026-10-15T23:00:00Z",season:2026,
    home:{id:"1",name:"Toronto FC"},away:{id:"2",name:"New York City FC"}};
  const athlete={id:"11",displayName:"Test Attacker",
    position:{abbreviation:"F"},injuries:[]};
  const match={rosters:[
    {team:{id:"1",name:"Toronto FC"},roster:[{athlete,
      position:{abbreviation:"F"},stats:[
        {name:"goalAssists",value:2},{name:"totalShots",value:3}]}]},
    {team:{id:"3",name:"Other Team"},roster:[{athlete:{id:"33",displayName:"Opponent"},
      position:{abbreviation:"F"},stats:[
        {name:"goalAssists",value:0},{name:"totalShots",value:2}]}]}
    ],header:{competitions:[{date:"2026-03-21T21:00:00Z"}]}};
  const mock={call:async p=>{
    if(p.kind==="roster")return {athletes:p.teamId==="1"?[athlete]:[]};
    if(p.kind==="gamelog")return {events:p.season==="2026"?
      {"12345":{id:"12345",gameDate:"2026-03-21T21:00:00Z"}}:{}};
    if(p.kind==="summary")return match;
    if(p.kind==="schedule")return {events:[]};
    throw Error("unrecognized ESPN source "+p.kind);
  }};
  const out=await loadVerifiedEvidence({client:mock,offer,game,league:"usa.1"});
  assert.equal(out.season,2026);
  assert.equal(out.player.id,"11");
  assert.equal(out.games.length,1);
  assert.equal(out.games[0].season,2026);
  assert.equal(out.games[0].actual,2);
  assert.equal(out.games[0].opponent,"Other Team");
});
