import test from "node:test";
import assert from "node:assert/strict";
import {onRequestGet,normalizePropLineOdds} from "../functions/api/lines.js";

const stamp=()=>new Date().toISOString();
const request=new Request("https://matchup-nightmare-v2.pages.dev/api/lines?sport=nfl&date=2026-10-11");
const env={PROPLINE_API_KEY:"my-propline-secret"};
const event=({point=0.5,suspended=false,stampAt=stamp()}={})=>({
  id:"10",espn_event_id:"401999111",sport_key:"football_nfl",
  home_team:"Los Angeles Rams",away_team:"Buffalo Bills",
  commence_time:"2026-10-12T00:20:00Z",
  bookmakers:[
    {key:"draftkings",title:"DraftKings",markets:[{
      key:"player_receptions",last_update:stampAt,
      line_type:"alternate",suspended_at:suspended?stamp():null,
      outcomes:[
        {name:"Over",description:"Verified Receiver (BUF)",point,price:-120,
          player_id:"espn:12345",outcome_id:"price1001"},
        {name:"Under",description:"Verified Receiver (BUF)",point,price:100}
      ]}]},
    {key:"prizepicks",title:"PrizePicks",markets:[{
      key:"player_receptions",last_update:stampAt,outcomes:[
        {name:"Over",description:"Excluded DFS",point:1.5,price:100}
      ]}]}
  ]
});
const call=async({odds=[event()],sports=[{key:"football_nfl",title:"NFL"}],secret=env,
  quota="995",status=200}={})=>{
  const old=globalThis.fetch;
  const hits=[];
  globalThis.fetch=async(url,opts)=>{
    const parsed=new URL(url);
    hits.push(parsed.toString());
    assert.equal(parsed.hostname,"api.prop-line.com");
    assert.equal(opts.headers["X-API-Key"],"my-propline-secret");
    if(parsed.pathname==="/v1/sports")
      return new Response(JSON.stringify(sports),{status:200});
    assert.equal(parsed.searchParams.get("includeBookIds"),"true");
    assert.ok(parsed.searchParams.get("markets").includes("player_receptions"));
    return new Response(JSON.stringify(odds),{status,headers:{"X-Daily-Remaining":quota}});
  };
  try{return {response:await onRequestGet({request,env:secret}),hits};}
  finally{globalThis.fetch=old;}
};
test("without own PropLine API key no guessed sportsbook lines are shown",async()=>{
  const response=await onRequestGet({request,env:{}});
  assert.equal(response.status,503);
  const body=await response.json();
  assert.equal(body.status,"integration-required");
  assert.deepEqual(body.projections,[]);
  assert.doesNotMatch(JSON.stringify(body),/PrizePicks|my-propline-secret/);
});
test("free API key uses PropLine v1 authenticated sportsbook odds with exact ALT line",async()=>{
  const {response,hits}=await call();
  assert.equal(response.status,200);
  const body=await response.json();
  assert.equal(body.status,"connected");
  assert.equal(body.source,"PropLine");
  assert.equal(body.dailyRequestsRemaining,995);
  assert.equal(hits.length,2);
  assert.equal(body.projections.length,1);
  const [p]=body.projections;
  assert.equal(p.book,"DraftKings");
  assert.equal(p.bookKey,"draftkings");
  assert.equal(p.line,0.5);
  assert.equal(p.price,-120);
  assert.equal(p.variant,"alternative");
  assert.equal(p.espnPlayerId,"12345");
  assert.equal(p.gameId,"401999111");
  assert.equal(p.player,"Verified Receiver");
  assert.equal(p.position,null);
  assert.equal(p.team,null);
  assert.doesNotMatch(JSON.stringify(body),/my-propline-secret/);
});
test("single-source enforcement excludes every book except DraftKings",async()=>{
  const draftkings=event();
  const otherBook=JSON.parse(JSON.stringify(draftkings.bookmakers[0]));
  otherBook.key="fanduel";otherBook.title="FanDuel";
  otherBook.markets[0].outcomes[0].point=4.5;
  const allBooks={...draftkings,bookmakers:[
    otherBook,draftkings.bookmakers[0],
    {...otherBook,key:"betmgm",title:"BetMGM"}
  ]};
  const {response}=await call({odds:[allBooks]});
  const body=await response.json();
  assert.equal(body.status,"connected");
  assert.equal(body.sportsbook,"DraftKings");
  assert.equal(body.projections.length,1);
  assert.ok(body.projections.every(p=>p.bookKey==="draftkings"));
  assert.equal(body.projections[0].line,0.5);
});
test("unsupported and suspended markets do not create lines",()=>{
  const quoted=normalizePropLineOdds([event({suspended:true})],{
    sport:"nfl",date:"2026-10-11",now:Date.now()
  });
  assert.equal(quoted.length,0);
  const stale=normalizePropLineOdds([event({stampAt:new Date(Date.now()-50*60000).toISOString()})],{
    sport:"nfl",date:"2026-10-11",now:Date.now()
  });
  assert.equal(stale.length,0);
});
test("sport catalog mismatch is identified as unavailable instead of substituting another league",async()=>{
  const {response}=await call({sports:[{key:"basketball_nba",title:"NBA"}]});
  const data=await response.json();
  assert.equal(response.status,424);
  assert.equal(data.status,"sport-unavailable");
  assert.deepEqual(data.projections,[]);
});
test("PropLine odds quote updates are tracked only with explicitly configured snapshot storage",async()=>{
  let stored=null;
  const snapshots={get:async()=>stored,put:async(_key,data)=>{stored=data;}};
  let r=await call({secret:{...env,PROJECTION_SNAPSHOTS:snapshots}});
  assert.equal((await r.response.json()).changeTracking,"baseline-created");
  r=await call({secret:{...env,PROJECTION_SNAPSHOTS:snapshots},
    odds:[event({point:1.5})]});
  const b=await r.response.json();
  assert.equal(b.changeTracking,"verified");
  assert.ok(b.changes.some(x=>x.kind==="removed-or-suspended"));
  assert.ok(b.changes.some(x=>x.kind==="added"));
});
test("valid event with empty bookmakers produces zero results, not placeholders",async()=>{
  const {response}=await call({odds:[{...event(),bookmakers:[]}]});
  assert.equal((await response.json()).projections.length,0);
});
