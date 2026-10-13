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
