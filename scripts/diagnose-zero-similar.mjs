import {completedTeamGames,playersFromBoxscore} from "../public/lib/evidence-client-v3.js";
import {parseFootballDefenseRanks} from "../public/lib/football-defense-ranks.js";
import {buildDefenseContext,strictDefenseGate,strictDefenseComparison}
  from "../public/lib/nfl-defense-depth.js";
const root="https://site.api.espn.com/apis/site/v2/sports/football/nfl/";
const gameroot="https://site.web.api.espn.com/apis/common/v3/sports/football/nfl/";
const request=async(path)=>{
  const res=await fetch(path,{signal:AbortSignal.timeout(10000)});
  if(!res.ok)throw Error(res.status+" "+path);
  return res.json();
};
const teams=[["Rams","14",2026],["Bills","2",2026],["Rams2025","14",2025],
["Bills2025","2",2025],["Seahawks2025","26",2025]];
const qs=[];
for(const [name,id,year] of teams){
 try{
  const [schedule,stats]=await Promise.all([
    request(root+"teams/"+id+"/schedule?season="+year+"&limit=100"),
    request(root+"teams/"+id+"/statistics?season="+year)
  ]);
  const ev=schedule.events||[];
  const cutoff=(year===2026?"2026-10-20T00:00:00Z":
    year+"-12-24T00:00:00Z");
  const qualified=completedTeamGames(schedule,id,cutoff,year);
  console.log("RAW EVENT "+JSON.stringify({name,keys:Object.keys(ev[0]||{}),
    event:ev[0]&&{id:ev[0].id,status:ev[0].status,
    competitions:ev[0].competitions?.[0]&&{
      keys:Object.keys(ev[0].competitions[0]),status:ev[0].competitions[0].status,
      competitors:ev[0].competitions[0].competitors?.map(x=>({
        keys:Object.keys(x),winner:x.winner,score:x.score,
        teamId:x.team?.id
      }))}},
    eventLast:ev[ev.length-1]&&{id:ev[ev.length-1].id,
      status:ev[ev.length-1].status,
      compStatus:ev[ev.length-1].competitions?.[0]?.status}
   }).slice(0,3900));
  const ranks=parseFootballDefenseRanks(stats,{season:year,teamId:id});
  console.log("TEAM "+JSON.stringify({name,year,scheduleKeys:Object.keys(schedule),
    events:ev.length,firstEvent:ev[0]&&{id:ev[0].id,date:ev[0].date,
      season:ev[0].season,status:ev[0].status,
      competitions:ev[0].competitions?.[0]?.competitors?.map(c=>({id:c.team?.id,
        name:c.team?.displayName}))},
    completed:qualified.length,completedFirst:qualified.slice(0,3),
    statsKeys:Object.keys(stats),statsOpponentSample:JSON.stringify(stats.results?.opponent)?.slice(0,400),
    ranks}));
  if(qualified.length)qs.push({name,id,year,gameId:qualified[0].id});
 }catch(e){console.log("TEAM ERROR "+name+" "+String(e));}
}
for(const g of qs.slice(0,3)){
  try{
   const box=await request(root+"summary?event="+g.gameId);
   console.log("SUMMARY STRUCT "+JSON.stringify({name:g.name,
    keys:Object.keys(box),
    rosters:Array.isArray(box.rosters)?box.rosters.map(x=>({
      keys:Object.keys(x),team:x.team?.id,size:x.roster?.length,
      sample:x.roster?.[0]&&{position:x.roster[0].position,
      athlete:x.roster[0].athlete?.id}})):null
    }).slice(0,2200));
   const groups=box.boxscore?.players?.[0]?.statistics||[];
   console.log("ATHLETE SHAPE "+JSON.stringify({name:g.name,
     first:groups.filter(x=>x.athletes?.length).slice(0,3).map(x=>({
       group:x.name,groupKeys:Object.keys(x),
       rowKeys:Object.keys(x.athletes[0]),
       row:x.athletes[0]
     }))}).slice(0,3800));
   const others=box.boxscore?.players||[];
   const opposing=others.find(x=>String(x.team?.id)!==String(g.id));
   if(opposing?.team?.id){
     const roster=await request(root+"teams/"+opposing.team.id+
       "/roster?season="+g.year);
     console.log("ROSTER "+JSON.stringify({name:g.name,team:opposing.team.id,
       keys:Object.keys(roster),athleteSample:(roster.athletes||[]).flatMap(x=>x.items||[])
         .slice(0,4).map(x=>({id:x.id,position:x.position?.abbreviation,
          name:x.displayName})),
       counts:roster.athletes?.map(x=>({group:x.position,count:x.items?.length}))
     }));
   }
   const teams=box.boxscore?.players||[];
   console.log("BOX "+JSON.stringify({name:g.name,gameId:g.gameId,
    boxTeams:teams.map(t=>({id:t.team?.id,groups:t.statistics?.map(k=>({
      name:k.name,labels:k.labels,first:k.athletes?.[0]&&{
        position:k.athletes?.[0]?.athlete?.position,
        stats:k.athletes?.[0]?.stats
      }
    }))})),
    rb:teams.map(t=>({id:t.team?.id,
      rbs:playersFromBoxscore(box,"nfl",t.team.id).filter(x=>x.position==="RB").slice(0,3)}))
   }).slice(0,7000));
   const c=await buildDefenseContext({teamId:g.id,season:g.year,
     cutoff:(g.year===2026?"2026-10-20T00:00:00Z":"2025-12-24T00:00:00Z"),
     role:"RB",stat:"rushingYards",
     schedule:(tid,year)=>request(root+"teams/"+tid+"/schedule?season="+year+"&limit=100"),
     summary:gid=>request(root+"summary?event="+gid)});
   console.log("CONTEXT "+JSON.stringify({name:g.name,ctx:c}));
  }catch(e){console.log("BOX ERROR "+g.name+" "+String(e));}
}
try{
 const log=await request(gameroot+"athletes/12483/gamelog?season=2026");
 console.log("LOG "+JSON.stringify({keys:Object.keys(log),
   eventsCount:Object.keys(log.events||{}).length}));
}catch(e){console.log("LOG ERROR "+String(e))}

import {makeEvidenceClient,loadVerifiedEvidence} from "../public/lib/evidence-client-v3.js";
import {analyzeVerifiedProp} from "../public/lib/research-v3.js";
// Construct ONLY a test research input with a hypothetical quote.
// No sportsbook quote/odds is fetched or reported as a real betting market.
const sourceClient=makeEvidenceClient({concurrency:8,fetcher:async relative=>{
  const params=new URL(relative,"https://local.test").searchParams;
  const kind=params.get("kind"),id=params.get("teamId"),
    season=params.get("season");
  const path=kind==="roster"||kind==="schedule"||kind==="teamstats"
    ?root+"teams/"+id+"/"+(kind==="teamstats"?"statistics":kind)+
      "?season="+season+(kind==="schedule"?"&limit=100":"")
    :kind==="summary"?root+"summary?event="+params.get("gameId")
    :gameroot+"athletes/"+params.get("playerId")+"/gamelog?season="+season;
  return fetch(path,{signal:AbortSignal.timeout(11000)});
}});
const future={id:"999990001",season:2026,date:"2026-10-14T19:00:00Z",
  home:{id:"14",name:"Los Angeles Rams"},away:{id:"2",name:"Buffalo Bills"}};
const offer={id:"hypothetical-test-no-sportsbook",source:"PropLine",status:"active",
  sport:"nfl",player:"Matthew Stafford",espnPlayerId:"12483",
  stat:"passingYards",position:"QB",market:"Passing yards",line:199.5,
  quotedAt:"2026-10-12T17:00:00Z",gameDateLocal:"2026-10-14",
  book:"DraftKings",bookKey:"draftkings",variant:"standard"};
try{
  const stage=await loadVerifiedEvidence({client:sourceClient,offer,game:future,
    onStage:message=>{if(/Comparing|Checking/.test(message))
      console.log("LIVE STAGE "+message);}});
  const result=analyzeVerifiedProp({offer,season:stage.season,games:stage.games,
    upcomingDefense:stage.upcomingDefense,
    upcomingContext:stage.upcomingContext,
    defensiveProfiles:stage.defensiveProfiles,
    matchupModel:stage.matchupModel,
    now:"2026-10-13T02:00:00Z"});
  console.log("LIVE ESPN VERIFIED SIMILARS "+JSON.stringify({
    player:stage.player.name,recordedGames:stage.games.length,
    currentSeasonResults:result?.recent.tracked,
    opponentRanks:stage.upcomingDefense?.passing?.rank,
    contexts:stage.defensiveProfiles.length,
    historicalVerified:result?.similar?.tracked,
    examples:result?.similarGames.map(g=>({
      id:g.id,opponent:g.opponent,actual:g.actual,
      season:g.season,positionCoverage:g.contextGames,
      matchBasis:g.matchBasis})).slice(0,6),
    warnings:result?.limitations?.slice(0,3),
    sourceCalls:sourceClient.stats()
  }).slice(0,5500));
  if(!result||result.similar.tracked<1)
    throw Error("Live ESPN end-to-end historical similarity still zero.");
}catch(e){
  console.log("LIVE ESPN DIAGNOSTIC FAILED "+String(e));
  throw e;
}
