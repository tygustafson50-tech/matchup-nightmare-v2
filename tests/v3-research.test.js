import test from "node:test";
import assert from "node:assert/strict";
import {analyzeVerifiedProp,buildDefensiveCohorts,hitSummary,
  resultAtLine,seasonWindow,positionGroup,rankEvidence} from "../public/lib/research-v3.js";
import {supportsMarket} from "../public/lib/research-v3.js";
import {playersFromBoxscore,gamelogEvents,concededAgainstPosition} from "../public/lib/evidence-client-v3.js";

const sourceDate=new Date().toISOString();
const offer={id:"pp-1",source:"PropLine",book:"DraftKings",bookKey:"draftkings",sport:"nfl",status:"active",
  player:"Verified Receiver",position:"WR",team:"Buffalo Bills",
  opponent:"Rams",stat:"receivingYards",market:"Receiving yards",
  line:49.5,variant:"standard",quotedAt:sourceDate,gameDateLocal:"2026-10-11",
  espnPlayerId:"11"};
const defense=(season,teamId,gameId,allowed,volume,asOf)=>({
  verified:true,sport:"nfl",position:"WR",stat:"receivingYards",season,
  teamId:String(teamId),gameId,asOf,pregameGames:5,
  metrics:{allowed,volume}
});
function dataset(){
  const profiles=[],games=[];
  for(const year of [2026,2025,2024,2023]){
    for(let i=0;i<8;i++){
      const id=String(year*100+i),date=year+"-09-"+String(i+1).padStart(2,"0")+"T19:00:00Z";
      const allowed=70+i*10,volume=10+i*2;
      profiles.push(defense(year,id,year+"-game-"+i,allowed,volume,date));
      if(year===2026||i<4)games.push({
        id:year+"-game-"+i,date,season:year,
        sport:"nfl",playerId:"11",stat:"receivingYards",actual:i===0?60:80,
        opponent:"Team "+i,opponentId:id,team:"Current or former team",
        verified:true,source:"ESPN game summary"
      });
    }
  }
  const upcoming=defense(2026,"99",null,100,16,"2026-10-10T12:00:00Z");
  profiles.push(upcoming);
  return {profiles,games,upcoming};
}
test("similar matchups use exactly three PREVIOUS seasons, never current",()=>{
  assert.deepEqual(seasonWindow(2026),[2025,2024,2023]);
  assert.equal(positionGroup("nfl","WR"),"WR");
  assert.equal(positionGroup("nba","PG"),"PG");
  assert.equal(positionGroup("soccer","ST"),"F");
});
test("today's exact current PropLine line is evaluated independently in each game",()=>{
  const data=dataset();
  const old=data.games[0];
  data.games.push({...old,id:"unknown-season",season:2022,date:"2022-08-01T19:00:00Z",
    actual:999});
  const result=analyzeVerifiedProp({
    offer,season:2026,games:data.games,upcomingDefense:data.upcoming,
    defensiveProfiles:data.profiles});
  assert.equal(result.line,49.5);
  assert.equal(result.variant,"standard");
  assert.equal(result.recent.tracked,5);
  assert.equal(result.recent.hits,5);
  assert.equal(result.recent.percent,100);
  assert.ok(result.recentGames.every(g=>g.season===2026));
  assert.ok(result.similarGames.length>0);
  assert.ok(result.similarGames.every(g=>[2025,2024,2023].includes(g.season)));
  assert.equal(result.similarGames.some(g=>g.id==="unknown-season"),false);
  assert.equal(result.similar.tracked,result.similarGames.length);
  assert.equal(result.similar.hits,result.similarGames.filter(g=>g.actual>49.5).length);
  assert.equal(result.similar.percent,100);
  assert.equal(result.recommendation,"OVER");
  assert.equal(result.similarGames.every(g=>g.defenseReason.includes("normalized")),true);
});
test("zero, push and under remain true results and not forced 100%",()=>{
  assert.equal(resultAtLine(0,0.5),"UNDER");
  assert.equal(resultAtLine(2.5,2.5),"PUSH");
  assert.equal(resultAtLine(3,2.5),"OVER");
  assert.deepEqual(hitSummary([{actual:0},{actual:2.5},{actual:3}],2.5),
    {hits:1,tracked:3,pushes:1,percent:33.3});
});
test("no evidence or unsourced/non-PropLine offer never creates a recommendation",()=>{
  const data=dataset();
  assert.equal(analyzeVerifiedProp({offer:{...offer,source:"Research only"},
    season:2026,games:data.games,upcomingDefense:data.upcoming,
    defensiveProfiles:data.profiles}),null);
  const empty=analyzeVerifiedProp({offer,season:2026,games:[],
    upcomingDefense:null,defensiveProfiles:[]});
  assert.equal(empty.recommendation,null);
  assert.equal(empty.recent.tracked,0);
  assert.equal(empty.similar.tracked,0);
});
test("game with missing statistic not invented as zero",()=>{
  const data=dataset();
  data.games[0].actual=null;
  const result=analyzeVerifiedProp({offer,season:2026,games:data.games,
    upcomingDefense:data.upcoming,defensiveProfiles:data.profiles});
  assert.equal(result.recent.tracked,5);
  assert.ok(!result.recentGames.some(x=>x.actual===null));
});
test("historical defender must be position, stat and season normalized",()=>{
  const data=dataset();
  const cohort=buildDefensiveCohorts(data.profiles);
  assert.ok(cohort["nfl|2026|WR|receivingYards|"].teamCount>=5);
  const missing=data.profiles.filter(p=>p.season===2026);
  const out=analyzeVerifiedProp({offer,season:2026,games:data.games,
    upcomingDefense:data.upcoming,defensiveProfiles:missing});
  assert.equal(out.similarGames.some(g=>g.season===2025),false);
  assert.ok(out.limitations.some(x=>/Insufficient independently verified position-specific comparable|Missing verified position\/stat pregame defense evidence/i.test(x)));
});
test("sport/role/market separation does not reuse NFL features as NBA features",()=>{
  const data=dataset();
  const result=analyzeVerifiedProp({offer:{...offer,sport:"nba",position:"PG",
    stat:"points",market:"Points"},season:2026,games:data.games,
    upcomingDefense:data.upcoming,defensiveProfiles:data.profiles});
  assert.equal(result.similar.tracked,0);
});
test("raw ESPN summary parser does not invent missing stats",()=>{
  const summary={boxscore:{players:[
    {team:{id:"1"},statistics:[{name:"receiving",labels:["REC","YDS","TGTS"],
      athletes:[{athlete:{id:"11",displayName:"Receiver",position:{abbreviation:"WR"}},
        stats:["3","62","6"]}]}]},
    {team:{id:"2"},statistics:[{name:"receiving",labels:["REC","YDS","TGTS"],
      athletes:[]}]}
  ]}};
  const player=playersFromBoxscore(summary,"nfl","1")[0];
  assert.equal(player.stats.receivingYards,62);
  assert.equal(player.stats.receptions,3);
  assert.equal(player.stats.targets,6);
  assert.equal(player.stats.passingYards,undefined);
  assert.deepEqual(concededAgainstPosition(summary,{
    sport:"nfl",defenseId:"2",role:"WR",stat:"receivingYards"}),
    {allowed:62,volume:6,statSource:"receivingYards",volumeSource:"targets"});
});
test("gamelog only accepts dated games before event within specified season",()=>{
  const raw={events:{
    "12345":{id:"12345",gameDate:"2026-09-12T00:00:00Z"},
    "99999":{id:"99999",gameDate:"2026-10-20T00:00:00Z"},
    "22222":{id:"22222",date:"2026-09-04T00:00:00Z",seasonYear:2025}
  }};
  assert.deepEqual(gamelogEvents(raw,2026,"2026-10-11T00:00:00Z").map(x=>x.id),
    ["12345"]);
});

test("ESPN G/F basketball roles resolve to actual guard/forward groups",()=>{
  for(const pos of ["G","PG","SG","Guard","Point Guard"])
    assert.equal(positionGroup("ncaab",pos),"G",pos);
  for(const pos of ["F","SF","PF","Forward"])
    assert.equal(positionGroup("ncaab",pos),"F",pos);
  assert.equal(positionGroup("nba","PG"),"PG");
  assert.equal(positionGroup("nba","SF"),"SF");
  assert.equal(positionGroup("nba","C"),"C");
  for(const stat of ["points","assists","rebounds","threes"])
    assert.equal(supportsMarket("ncaab","G",stat),true,stat);
});

test("NBA and NCAAB use verified stat allowances when no five-team season cohort is available",()=>{
  for(const sport of ["nba","ncaab"]){
    const offer={id:"quoted-1",source:"PropLine",sport,status:"active",
      player:"Actual Guard",espnPlayerId:"101",position:"G",
      team:"Real Team",opponent:"Other Team",book:"DraftKings",
      bookKey:"draftkings",stat:"points",market:"Points",line:21.5,
      variant:"standard",quotedAt:new Date().toISOString(),
      gameDateLocal:"2026-10-12"};
    const past={verified:true,sport,teamId:"9",gameId:"game-1",position:"G",
      season:2026,stat:"points",pregameGames:5,asOf:"2026-10-01T00:00:00Z",
      metrics:{allowed:24,volume:15}};
    const current={...past,teamId:"88",gameId:null,season:2027,
      metrics:{allowed:22,volume:14}};
    const game={id:"game-1",date:"2026-02-08T00:00:00Z",season:2026,
      playerId:"101",stat:"points",sport,team:"Real Team",
      opponent:"Other Team",opponentId:"9",actual:26,
      source:"ESPN game summary",verified:true};
    const result=analyzeVerifiedProp({offer,season:2027,
      games:[game],upcomingDefense:current,
      defensiveProfiles:[past,current]});
    assert.equal(result.recent.tracked,0,sport);
    assert.equal(result.similar.tracked,1,sport);
    assert.equal(result.similarGames[0].actual,26,sport);
    assert.match(result.similarGames[0].defenseReason,/Raw same-position comparison/);
  }
});

test("MLB hitter comparable pitching profiles do not require unavailable invented pitcher handedness",()=>{
  const offer={id:"hits-1",source:"PropLine",sport:"mlb",status:"active",
    player:"Verified Hitter",espnPlayerId:"199",position:"DH",
    team:"Real Team",opponent:"Other Team",book:"DraftKings",
    bookKey:"draftkings",stat:"hits",market:"Hits",line:0.5,
    variant:"standard",quotedAt:new Date().toISOString(),
    gameDateLocal:"2026-10-12"};
  const current={sport:"mlb",stat:"hits",position:"BATTER",verified:true,
    teamId:"2",season:2026,gameId:null,pregameGames:6,asOf:"2026-10-11T00:00:00Z",
    metrics:{allowed:8,volume:32}};
  const historical={...current,teamId:"3",gameId:"mlb1",season:2025,
    metrics:{allowed:7,volume:30}};
  const game={id:"mlb1",date:"2025-09-20T00:00:00Z",season:2025,
    playerId:"199",stat:"hits",sport:"mlb",team:"Real Team",
    opponent:"Other Team",opponentId:"3",actual:2,
    source:"ESPN game summary",verified:true};
  const result=analyzeVerifiedProp({offer,season:2026,games:[game],
    upcomingDefense:current,defensiveProfiles:[historical,current]});
  assert.equal(result.similar.tracked,1);
  assert.equal(result.similarGames[0].actual,2);
  assert.match(result.similarGames[0].defenseReason,/no verified handedness adjustment/);
});
