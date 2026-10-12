const base="https://site.web.api.espn.com/apis/common/v3/sports/football/nfl/athletes/";
const esBase="https://site.api.espn.com/apis/site/v2/sports/football/nfl/";
const arr=[["Matthew Stafford","12483"],["Josh Allen","3918298"],["Jordan Whittington","4430104"]];
const show=v=>JSON.stringify(v).slice(0,1700);
for(const [name,id] of arr){
 for(const season of [2026,2025,2024]){
  const url=base+id+"/gamelog?season="+season;
  try{
   const res=await fetch(url,{signal:AbortSignal.timeout(10000)});
   const d=await res.json(),events=d.events;
   console.log("GAMELOG",name,id,season,res.status,JSON.stringify({
      keys:Object.keys(d),
      seasonTypes:Array.isArray(d.seasonTypes)?d.seasonTypes.map(x=>({id:x.id,name:x.name,keys:Object.keys(x),categories:x.categories?.map(c=>({name:c.name,keys:Object.keys(c),stats:c.statistics?.length}))})).slice(0,3):null,
      eventShape:Array.isArray(events)?"array":typeof events,
      events:events&&typeof events==="object"?Object.entries(events).slice(0,4).map(([k,e])=>({key:k,value:e})):null,
      labels:d.labels,
      names:d.names,
      athlete:d.athlete?.displayName
    }).slice(0,4500));
   if(name==="Matthew Stafford"&&season===2026&&events){
     const first=Object.entries(events)[0];
     const gid=first&&(/^[0-9]+$/.test(first[0])?first[0]:first[1]?.id);
     if(gid){
       const r=await fetch(esBase+"summary?event="+gid,{signal:AbortSignal.timeout(12000)});
       const detail=await r.json();
       console.log("SUMMARY",gid,r.status,JSON.stringify({
        keys:Object.keys(detail),
        boxKeys:Object.keys(detail.boxscore||{}),
        boxPlayers:(detail.boxscore?.players||[]).map(t=>({
           team:t.team?.id,
           stats:(t.statistics||[]).map(g=>({name:g.name,labels:g.labels,keys:Object.keys(g),firstAthlete:g.athletes?.[0]&&{id:g.athletes[0].athlete?.id,stats:g.athletes[0].stats,keys:Object.keys(g.athletes[0])}}))
         })).slice(0,2),
        headerKeys:Object.keys(detail.header||{}),
        week:detail.header?.week
       }).slice(0,7000));
     }
   }
  }catch(e){console.log("GAMELOG ERROR",name,season,String(e).slice(0,200))}
 }
}
for(const teamId of ["14","2"]){
 const r=await fetch(esBase+"teams/"+teamId+"/roster?season=2026",{signal:AbortSignal.timeout(12000)});
 const d=await r.json();
 console.log("ROSTER",teamId,r.status,JSON.stringify({
   keys:Object.keys(d),head:(d.athletes||d.items||[]).slice(0,2),
   subgroups:d.groups?.slice(0,2)
 }).slice(0,5000))
}

const {gamelogEvents,playersFromBoxscore,loadVerifiedEvidence}=await import("../public/lib/evidence-client-v3.js");
const {analyzeVerifiedProp}=await import("../public/lib/research-v3.js");
for(const [player,id,team,stat] of [["Matthew Stafford","12483","14","passingYards"],
  ["Josh Allen","3918298","2","passingYards"]]){
 const raw=await (await fetch(base+id+"/gamelog?season=2026")).json();
 const events=gamelogEvents(raw,2026,"2026-10-14T00:00:00Z");
 const first=events[0];
 const box=first?await (await fetch(esBase+"summary?event="+first.id)).json():null;
 const athlete=box?playersFromBoxscore(box,"nfl",team).find(p=>p.id===id):null;
 console.log("PIPELINE",JSON.stringify({
  player,year:2026,totalEvents:Object.keys(raw.events||{}).length,
  selectedEvents:events.length,first:first&&{id:first.id,date:first.date},
  boxScoreTeams:box?.boxscore?.players?.map(x=>x.team?.id),
  foundPlayer:Boolean(athlete),actualPassingYards:athlete?.stats?.passingYards,
  statFields:athlete?Object.keys(athlete.stats):[]
 }));
}

const memo=new Map();
const client={call:async params=>{
 const key=JSON.stringify(params);
 if(!memo.has(key))memo.set(key,(async()=>{
  let url=esBase;
  if(params.kind==="roster"||params.kind==="schedule"||params.kind==="teamstats")
    url+="teams/"+params.teamId+"/"+(params.kind==="teamstats"?"statistics":params.kind)+"?season="+params.season;
  else if(params.kind==="summary")url+="summary?event="+params.gameId;
  else if(params.kind==="gamelog")url=base+params.playerId+"/gamelog?season="+params.season;
  else throw Error("Unknown kind "+params.kind);
  const response=await fetch(url,{signal:AbortSignal.timeout(18000)});
  if(!response.ok)throw Error("ESPN "+params.kind+" HTTP "+response.status);
  return response.json();
 })());
 return memo.get(key);
}};
for(const [who,playerId,teamId,enemyId,stat] of [
 ["Matthew Stafford","12483","14","2","passingYards"],
 ["Josh Allen","3918298","2","14","passingYards"]]){
 try{
  const offer={id:"test-"+playerId,source:"PropLine",book:"DraftKings",bookKey:"draftkings",
    status:"active",sport:"nfl",player:who,espnPlayerId:playerId,position:null,
    stat,market:"Passing yards",line:199.5,variant:"standard",
    quotedAt:new Date().toISOString(),gameDateLocal:"2026-10-14",
    providerEventId:"provider-fixture",team:null,opponent:null};
  const game={id:"test-fixture",date:"2026-10-14T01:00:00Z",season:2026,
    home:{id:teamId,name:"Test Home"},away:{id:enemyId,name:"Test Away"}};
  const e=await loadVerifiedEvidence({client,offer,game,onStage:()=>{}});
  const enriched={...offer,position:e.player.position,team:e.team.name,
    opponent:e.enemy.name,espnPlayerId:e.player.id};
  const c=analyzeVerifiedProp({offer:enriched,season:e.season,games:e.games,
    upcomingDefense:e.upcomingDefense,defensiveProfiles:e.defensiveProfiles,
    matchupModel:e.matchupModel});
  console.log("ENDTOEND",JSON.stringify({
    who,matchupModel:e.matchupModel,verifiedPlayer:e.player.id,
    rawHistoryGames:e.games.length,years:e.games.reduce((a,x)=>(a[x.season]=(a[x.season]||0)+1,a),{}),
    defenseProfiles:e.defensiveProfiles.length,
    upcomingPassRank:e.upcomingDefense?.passing?.rank,
    latestGames:c?.recent?.tracked,qualifiedSimilar:c?.similar?.tracked,
    examples:c?.similarGames?.slice(0,3).map(g=>({year:g.season,date:g.date,
      opponent:g.opponent,stat:g.actual,rank:g.historicalRank})),
    notes:e.notes.slice(0,5),limitations:c?.limitations?.slice(0,3)
  }));
 }catch(e){console.log("ENDTOEND ERROR",who,String(e.stack||e).slice(0,1500))}
}
