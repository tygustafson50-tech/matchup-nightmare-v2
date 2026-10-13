import test from "node:test";
import assert from "node:assert/strict";
import {onRequestGet,normalizePropLineOdds}
  from "../functions/api/lines.js";

const stamp=()=>new Date().toISOString();
const DATE="2026-10-11";
const event=({id="10",point=0.5,suspended=false,stampAt=stamp(),
  sportKey="football_nfl",home="Los Angeles Rams",away="Buffalo Bills",
  marketKey="player_receptions",player="Verified Receiver (BUF)",
  book="draftkings"}={})=>({
  id,espn_event_id:"401999111",sport_key:sportKey,
  home_team:home,away_team:away,
  commence_time:"2026-10-12T00:20:00Z",
  bookmakers:[{key:book,title:book==="draftkings"?"DraftKings":"FanDuel",
    markets:[{key:marketKey,last_update:stampAt,line_type:"alternate",
      suspended_at:suspended?stamp():null,
      outcomes:[
        {name:"Over",description:player,point,price:-120,
          player_id:"espn:12345",outcome_id:"price1001"},
        {name:"Under",description:player,point,price:100}
      ]}]
  }]
});
const metadata=e=>({
  id:e.id,espn_event_id:e.espn_event_id,sport_key:e.sport_key,
  home_team:e.home_team,away_team:e.away_team,
  commence_time:e.commence_time
});
function req(sport="nfl",fixtures=null,date=DATE){
  const q=new URLSearchParams({sport,date});
  if(fixtures)q.set("fixtures",JSON.stringify(fixtures));
  return new Request("https://matchup-nightmare-v2.pages.dev/api/lines?"+q);
}
const env={PROPLINE_API_KEY:"my-propline-secret"};
async function call({odds=[event()],events=null,sports=null,secret=env,
  quota="995",request=req(),failStatus=null}={}){
  const old=globalThis.fetch;
  const hits=[];
  globalThis.fetch=async(url,opts)=>{
    const parsed=new URL(url);hits.push(parsed.toString());
    assert.equal(parsed.hostname,"api.prop-line.com");
    assert.equal(opts.headers["X-API-Key"],"my-propline-secret");
    if(parsed.pathname==="/v1/sports"){
      return new Response(JSON.stringify(sports||[
        {key:"football_nfl",title:"NFL"},{key:"basketball_nba",title:"NBA"},
        {key:"baseball_mlb",title:"MLB"},{key:"football_ncaaf",title:"NCAAF"},
        {key:"basketball_ncaab",title:"NCAAB"},
        {key:"soccer_epl",title:"Premier League"},
        {key:"soccer_spain_la_liga",title:"La Liga"}
      ]),{status:200});
    }
    if(parsed.pathname.endsWith("/events")){
      return new Response(JSON.stringify(events||odds.map(metadata)),{
        status:200,headers:{"X-Daily-Remaining":quota}
      });
    }
    assert.match(parsed.pathname,/\/events\/[^/]+\/odds$/);
    assert.equal(parsed.searchParams.get("includeBookIds"),"true");
    const enabled=(parsed.searchParams.get("bookmakers")||"").split(",");
    for(const book of ["draftkings","fanduel","bovada","fanatics",
      "hardrock","prizepicks"])
      assert.ok(enabled.includes(book),"Provider missing: "+book);
    assert.ok(parsed.searchParams.get("markets"));
    if(failStatus)
      return new Response(JSON.stringify({error:"quota"}),{
        status:failStatus,headers:{"X-Daily-Remaining":"0"}});
    const eventId=parsed.pathname.split("/").at(-2);
    const record=odds.find(x=>x.id===eventId);
    return new Response(JSON.stringify(record||{id:eventId,bookmakers:[]}),{
      status:200,headers:{"X-Daily-Remaining":quota}
    });
  };
  try{return {response:await onRequestGet({request,env:secret}),hits};}
  finally{globalThis.fetch=old;}
}

test("no private PropLine key means no fake lines",async()=>{
  const response=await onRequestGet({request:req(),env:{}});
  assert.equal(response.status,503);
  const body=await response.json();
  assert.equal(body.status,"integration-required");
  assert.deepEqual(body.projections,[]);
});
test("the official per-event PLAYER PROPS endpoint is used instead of bulk game lines",async()=>{
  const {response,hits}=await call();
  const body=await response.json();
  assert.equal(response.status,200);
  assert.equal(body.status,"connected");
  assert.equal(body.source,"PropLine");
  assert.equal(body.sportsbook,"Multiple verified sources");
  assert.equal(body.dailyRequestsRemaining,995);
  assert.equal(hits.length,3);
  assert.match(hits[1],/\/events$/);
  assert.match(hits[2],/\/events\/10\/odds/);
  assert.ok(new URL(hits[2]).searchParams.get("bookmakers").includes("fanduel"));
  assert.equal(body.eventsFound,1);
  assert.equal(body.eventsChecked,1);
  assert.equal(body.projections.length,1);
  const p=body.projections[0];
  assert.equal(p.bookKey,"draftkings");
  assert.equal(p.line,0.5);
  assert.equal(p.price,-120);
  assert.equal(p.variant,"alternative");
  assert.equal(p.espnPlayerId,"12345");
  assert.equal(p.gameId,"401999111");
  assert.equal(p.player,"Verified Receiver");
  assert.equal(p.team,null);
  assert.doesNotMatch(JSON.stringify(body),/my-propline-secret/);
});
test("the same player/stat can be quoted by DraftKings and FanDuel for comparison",async()=>{
  const dk=event(),fd=event({point:2.5,book:"fanduel"});
  const {response}=await call({odds:[{...dk,bookmakers:[...fd.bookmakers,...dk.bookmakers]}]});
  const body=await response.json();
  assert.equal(body.projections.length,2);
  assert.deepEqual(new Set(body.projections.map(x=>x.bookKey)),
    new Set(["draftkings","fanduel"]));
  assert.ok(body.projections.every(x=>x.source==="PropLine"));
});
test("selected fixtures: never spend free API requests on games not selected",async()=>{
  const a=event({id:"10"});
  const b={...event({id:"11",home:"New York Jets",away:"New England Patriots"}),
    espn_event_id:"401999112"};
  const {response,hits}=await call({odds:[a,b],request:req("nfl",[
    {id:"401999111",home:"Los Angeles Rams",away:"Buffalo Bills"}
  ])});
  const body=await response.json();
  assert.equal(body.projections.length,1);
  assert.equal(body.eventsChecked,1);
  assert.equal(hits.length,3);
  assert.ok(hits.every(u=>!u.includes("/events/11/odds")));
});
test("team name abbreviations do not drop selected events",async()=>{
  const a=event({home:"Los Angeles Rams",away:"Buffalo Bills"});
  const {response}=await call({odds:[a],request:req("nfl",[
    {id:"401999111",home:"LA Rams",away:"Buffalo Bills"}
  ])});
  assert.equal((await response.json()).eventsChecked,1);
});
test("invalid fixtures fail safely rather than querying unrelated odds",async()=>{
  const {response,hits}=await call({request:req("nfl",[
    {id:"unsafe",home:"Team 1",away:"Team 2"}
  ])});
  assert.equal(response.status,400);
  assert.ok(hits.length<=2);
});
test("suspended and old markets never turn into new quote cards",()=>{
  assert.equal(normalizePropLineOdds([event({suspended:true})],{
    sport:"nfl",date:DATE,now:Date.now()}).length,0);
  assert.equal(normalizePropLineOdds([event({
    stampAt:new Date(Date.now()-120*60000).toISOString()
  })],{sport:"nfl",date:DATE,now:Date.now()}).length,0);
});
test("missing game/season/league returns explicit no-event state, not fake props",async()=>{
  const {response}=await call({events:[]});
  const b=await response.json();
  assert.equal(b.status,"connected");
  assert.equal(b.eventsFound,0);
  assert.deepEqual(b.projections,[]);
  assert.match(b.notes.join(" "),/No selected events/);
});
test("no DraftKings player prices (NCAAB may be unsupported by the book)",async()=>{
  const base=event({sportKey:"basketball_ncaab",
    marketKey:"player_points",player:"Verified Guard",point:15.5});
  const {response}=await call({odds:[{...base,bookmakers:[]}],
    request:req("ncaab")});
  const b=await response.json();
  assert.equal(b.eventsChecked,1);
  assert.deepEqual(b.projections,[]);
  assert.match(b.notes.join(" "),/provider|sources|book/i);
});
test("sport key mismatch never routes football odds to a basketball league",async()=>{
  const {response}=await call({sports:[{key:"football_nfl",title:"NFL"}],
    request:req("nba")});
  assert.equal(response.status,424);
  assert.equal((await response.json()).status,"sport-unavailable");
});
test("all 6 sports correctly map a REAL quoted stat from the per-event endpoint",async()=>{
  const cases=[
    ["nfl","football_nfl","player_reception_yds","receivingYards",49.5],
    ["ncaaf","football_ncaaf","player_rush_yds","rushingYards",79.5],
    ["nba","basketball_nba","player_points","points",23.5],
    ["ncaab","basketball_ncaab","player_assists","assists",4.5],
    ["mlb","baseball_mlb","batter_hits","hits",0.5],
    ["soccer","soccer_epl","player_assists","assists",0.5]
  ];
  for(const [sport,sportKey,marketKey,stat,point] of cases){
    const quoted=event({sportKey,marketKey,point,player:"Verified Player"});
    const {response}=await call({odds:[quoted],request:req(sport)});
    const body=await response.json();
    assert.equal(body.projections.length,1,sport+" "+JSON.stringify(body.notes));
    assert.equal(body.projections[0].stat,stat,sport);
    assert.equal(body.projections[0].line,point,sport);
  }
});
test("provider 429 from per-event odds activates the existing saved-scan fallback",async()=>{
  const {response}=await call({failStatus:429});
  assert.equal(response.status,429);
  assert.equal((await response.json()).status,"rate-limited");
});
test("source tracking changes only when KV cache is explicitly configured",async()=>{
  let stored=null;
  const snapshots={get:async()=>stored,put:async(_,value)=>{stored=value;}};
  let x=await call({secret:{...env,PROJECTION_SNAPSHOTS:snapshots}});
  assert.equal((await x.response.json()).changeTracking,"baseline-created");
  x=await call({secret:{...env,PROJECTION_SNAPSHOTS:snapshots},
    odds:[event({point:1.5})]});
  const b=await x.response.json();
  assert.equal(b.changeTracking,"verified");
  assert.ok(b.changes.some(x=>x.kind==="removed-or-suspended"));
  assert.ok(b.changes.some(x=>x.kind==="added"));
});
