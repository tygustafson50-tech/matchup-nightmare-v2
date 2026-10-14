import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {safeEspnImage,verifiedHeadshot,rosterInjuryStatus,
  extractRosterVisuals,renderPlayerCardHeader}
  from "../public/lib/player-profile-v3.js";
import {loadVerifiedEvidence} from "../public/lib/evidence-client-v3.js";
import {saveCompletedScan,readLastScan}
  from "../public/lib/last-scan-cache.js";

const photo="https://a.espncdn.com/i/headshots/nfl/players/full/12483.png";
const teamLogo="https://a.espncdn.com/i/teamlogos/nfl/500/lar.png";
const otherLogo="https://a.espncdn.com/i/teamlogos/nfl/500/buf.png";
const when="2026-10-11T23:00:00.000Z";

test("only genuine HTTPS ESPN CDN photos or verified player IDs are used",()=>{
  assert.equal(safeEspnImage(photo),photo);
  assert.equal(safeEspnImage(teamLogo),teamLogo);
  for(const input of ["javascript:alert(1)",
    "https://a.espncdn.com.evil.test/headshot.png",
    "http://a.espncdn.com/not-secure.jpg",
    "https://phishing.com/pic.png",
    "https://a.espncdn.com@evil.com/pic.jpg",
    "data:image/svg+xml,<svg/>"]){
    assert.equal(safeEspnImage(input),null,input);
  }
  assert.equal(verifiedHeadshot("nfl","12483",null),photo);
  assert.equal(verifiedHeadshot("nba","22222",null),
    "https://a.espncdn.com/i/headshots/nba/players/full/22222.png");
  assert.equal(verifiedHeadshot("soccer","33333",null),
    "https://a.espncdn.com/i/headshots/soccer/players/full/33333.png");
  assert.equal(verifiedHeadshot("nfl","not-an-id",null),null);
});

test("a missing injury field is UNKNOWN, an empty injuries array only means not listed",()=>{
  assert.deepEqual(rosterInjuryStatus({},when),{
    source:"ESPN team roster",checkedAt:when,
    label:"Status not confirmed",kind:"unknown",detail:""
  });
  assert.equal(rosterInjuryStatus({injuries:[]},when).label,"No injury listed");
  assert.equal(rosterInjuryStatus({injuries:[]},when).kind,"not-listed");
  assert.equal(rosterInjuryStatus({injuries:[{status:"Active"}]},when).kind,
    "unknown");
});

test("real roster injury statuses and details are represented without falsely asserting healthy",()=>{
  const examples=[
    ["Questionable","Questionable","questionable"],
    ["Out","Out","out"],["Doubtful","Doubtful","out"],
    ["Injured Reserve","Injured reserve","out"],
    ["Day-To-Day","Day-to-day / game-time decision","questionable"],
    ["Game-Time Decision","Day-to-day / game-time decision","questionable"],
    ["Probable","Probable","questionable"],
    ["undisclosed","Injury reported","reported"]
  ];
  for(const [input,label,kind] of examples){
    const got=rosterInjuryStatus({injuries:[{
      status:input,details:{type:"Ankle"}
    }]},when);
    assert.equal(got.label,label,input);
    assert.equal(got.kind,kind,input);
    assert.equal(got.detail,"Ankle");
  }
  const a=rosterInjuryStatus({injuries:[
    {status:"Questionable"},{status:"Out"}]},when);
  assert.equal(a.label,"Out");
});

function card(injury={label:"Questionable",kind:"questionable",
  detail:"Ankle",checkedAt:when,source:"ESPN team roster"}){
  return {sport:"nfl",player:"Matthew Stafford",team:"Los Angeles Rams",
    opponent:"Buffalo Bills",position:"QB",book:"DraftKings",variant:"standard",
    line:195.5,price:-105,recommendation:"OVER",
    offer:{espnPlayerId:"12483",source:"PropLine",bookKey:"draftkings"},
    visuals:{headshotUrl:photo,teamLogo,opponentLogo:otherLogo,injury}};
}

test("card header shows genuine player photo, home/away logos and visible injury badge",()=>{
  const markup=renderPlayerCardHeader(card());
  assert.match(markup,/12483\.png/);
  assert.match(markup,/class="player-image"/);
  assert.match(markup,/class="team-logo-slot"/);
  assert.equal((markup.match(/class="team-logo-slot"/g)||[]).length,2);
  assert.match(markup,/Los Angeles Rams/);
  assert.match(markup,/Buffalo Bills/);
  assert.match(markup,/health-badge health-questionable/);
  assert.match(markup,/>Questionable<\/span>/);
  assert.match(markup,/Ankle/);
  assert.match(markup,/ESPN roster · checked/);
  assert.match(markup,/OVER supported/);
});

test("unverified injury and missing images show safe initials, not fake healthy or wrong logos",()=>{
  const x=card({kind:"unknown",label:"Status not confirmed",
    checkedAt:null});
  x.visuals.headshotUrl="https://evil.test/face.png";
  x.visuals.teamLogo="https://wrong-logo.test/1.png";
  x.offer.espnPlayerId=null;
  const markup=renderPlayerCardHeader(x);
  assert.match(markup,/player-initial/);
  assert.doesNotMatch(markup,/evil.test|wrong-logo.test|<img class="player-image"/);
  assert.match(markup,/Status not confirmed/);
  assert.doesNotMatch(markup,/>Healthy</);
});

test("saved scan status explicitly never represents injury designation as current",()=>{
  const x={...card(),cachedAt:when};
  const markup=renderPlayerCardHeader(x);
  assert.match(markup,/Saved: Questionable/);
  assert.match(markup,/Saved injury report — not rechecked/);
  assert.match(markup,/SAVED SCAN — NOT LIVE/);
});

test("player aliases or untrusted roster URL strings are HTML escaped",()=>{
  const x=card({label:'Out"><script>alert(1)</script>',
    kind:"out",detail:'ankle <img src=x onerror=1>',checkedAt:when});
  x.player="<script>Spurious</script>";
  const html=renderPlayerCardHeader(x);
  assert.doesNotMatch(html,/<script>|<img src=x/);
  assert.match(html,/&lt;script&gt;/);
  assert.match(html,/&lt;img src=x/);
});

test("roster recognition carries an actual ESPN injury and official headshot into resolved player",async()=>{
  const athlete={id:"12483",displayName:"Matthew Stafford",
    position:{abbreviation:"QB"},
    headshot:{href:photo},
    injuries:[{status:"Questionable",details:{type:"Back"}}]};
  const game={id:"401009001",season:2026,date:"2026-10-14T00:15:00Z",
    home:{id:"14",name:"Los Angeles Rams",logo:teamLogo},
    away:{id:"2",name:"Buffalo Bills",logo:otherLogo}};
  const client={call:async p=>{
    if(p.kind==="roster")return {athletes:p.teamId==="14"?
      [{position:"offense",items:[athlete]}]:[]};
    if(p.kind==="gamelog")return {events:{}};
    if(p.kind==="teamstats")return {results:{opponent:[]}};
    throw Error("Unexpected mock ESPN resource "+p.kind);
  }};
  const verified=await loadVerifiedEvidence({client,game,offer:{
    player:"Matthew Stafford",sport:"nfl",stat:"passingYards"},onStage:()=>{}});
  assert.equal(verified.player.id,"12483");
  assert.equal(verified.player.visuals.headshotUrl,photo);
  assert.equal(verified.player.visuals.injury.label,"Questionable");
  assert.equal(verified.player.visuals.injury.detail,"Back");
  assert.equal(verified.team.logo,teamLogo);
  assert.equal(verified.enemy.logo,otherLogo);
});

test("saved matchups preserve media and original report time for browser quota fallback",()=>{
  const m=new Map(),storage={
    getItem:k=>m.get(k)||null,setItem:(k,v)=>m.set(k,v)};
  const start=Date.parse("2026-10-11T22:00:00Z");
  const game={id:"401009002",date:"2026-10-14T00:15:00Z"};
  const data={sport:"nfl",date:"2026-10-13",league:"eng.1",games:[game]};
  const item={...card(),id:"prop-1",fixtureId:game.id,
    quotedAt:when,source:"PropLine",bookKey:"draftkings",stat:"passingYards"};
  const result=saveCompletedScan({...data,cards:[item]},storage,start);
  assert.equal(result.saved,1);
  const again=readLastScan(data,storage,start+1000);
  assert.equal(again.cards[0].visuals.headshotUrl,photo);
  assert.equal(again.cards[0].visuals.injury.label,"Questionable");
  assert.equal(again.cards[0].cachedAt,result.savedAt);
});

test("app always sends verified injury/photos and ESPN fixture team logos to displayed card",()=>{
  const s=readFileSync(new URL("../public/app.js",import.meta.url),"utf8");
  assert.match(s,/import \{renderPlayerCardHeader\}/);
  assert.match(s,/renderPlayerCardHeader\(c\)/);
  assert.match(s,/headshotUrl:input\.player\.visuals/);
  assert.match(s,/teamLogo:input\.team\.logo/);
  assert.match(s,/opponentLogo:input\.enemy\.logo/);
  assert.match(s,/injury:input\.player\.visuals/);
  assert.match(s,/img\[data-fallback-image\]/);
});
