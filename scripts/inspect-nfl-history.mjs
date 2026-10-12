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
