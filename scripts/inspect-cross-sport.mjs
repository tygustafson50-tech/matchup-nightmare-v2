const base="https://site.api.espn.com/apis/site/v2/sports/";
const web="https://site.web.api.espn.com/apis/common/v3/sports/";
const cases=[
 ["nba","basketball/nba","20261011"],["nba","basketball/nba","20261007"],
 ["mlb","baseball/mlb","20261010"],["ncaaf","football/college-football","20261010"],
 ["ncaab","basketball/mens-college-basketball","20251115"],
 ["soccer","soccer/eng.1","20260926"],["soccer","soccer/esp.1","20260927"],["soccer","soccer/usa.1","20261010"]
];
async function get(url){let res=await fetch(url,{signal:AbortSignal.timeout(10000)});
if(!res.ok)throw Error(res.status+" "+url);return res.json();}
for(const [sport,path,date] of cases){
 try{
 const board=await get(base+path+"/scoreboard?dates="+date+"&limit=100");
 const games=board.events||[];
 console.log("BOARD "+JSON.stringify({sport,path,date,count:games.length,
  first:games.slice(0,2).map(g=>({id:g.id,season:g.season,teams:g.competitions?.[0]?.competitors?.map(t=>({id:t.team?.id,name:t.team?.displayName}))}))}));
 if(!games.length)continue;
 const game=games[0],team=game.competitions?.[0]?.competitors?.[0]?.team;
 const year=game.season?.year||Number(date.slice(0,4));
 const roster=await get(base+path+"/teams/"+team.id+"/roster?season="+year);
 const summary=await get(base+path+"/summary?event="+game.id);
 const players=summary.boxscore?.players||[];
 const groups=(players[0]?.statistics||[]).slice(0,3);
 const athlete=groups.flatMap(g=>g.athletes||[]).find(a=>a.athlete?.id);
 const playerId=athlete?.athlete?.id;
 const playerInRoster=JSON.stringify(roster).includes('"id":"'+playerId+'"');
 const log=playerId?await get(web+path+"/athletes/"+playerId+"/gamelog?season="+year):null;
 console.log("DETAIL "+JSON.stringify({sport,path,date,game:game.id,season:year,
  rosterKeys:Object.keys(roster||{}),rosterRoot:roster.athletes?.slice(0,1).map(r=>({name:r.position,keys:Object.keys(r),count:r.items?.length})),
  boxTeams:players.map(x=>({id:x.team?.id,groups:x.statistics?.slice(0,2).map(g=>({name:g.name,labels:g.labels?.slice(0,25),first:g.athletes?.[0]?.stats?.slice(0,25),athletePosition:g.athletes?.[0]?.athlete?.position}))})),
  athlete:athlete?.athlete?.displayName,playerId,playerInRoster,
  gamelogKeys:Object.keys(log||{}),gamelogEvents:log?.events&&Object.keys(log.events).length,
  gamelogFirst:log?.events&&Object.values(log.events)[0]&&{date:Object.values(log.events)[0].gameDate,opp:Object.values(log.events)[0].opponent?.displayName}
 }).slice(0,8500));
 }catch(e){console.log("ERR "+sport+" "+date+" "+String(e).slice(0,400))}
}

for(const league of ["usa.1","eng.1"]){
 try{
 const board=await get(base+"soccer/"+league+"/scoreboard?dates=20261010&limit=100");
 const game=board.events?.[0];
 if(!game){console.log("SOCCERDEEP "+league+" no game");continue;}
 const summary=await get(base+"soccer/"+league+"/summary?event="+game.id);
 const box=summary.boxscore||{},rosters=summary.rosters||{};
 const firstTeam=game.competitions?.[0]?.competitors?.[0]?.team;
 const roster=await get(base+"soccer/"+league+"/teams/"+firstTeam.id+"/roster?season=2026");
 const athlete=(roster.athletes||[])[0];
 const athleteId=athlete?.id;
 const log=athleteId?await get(web+"soccer/"+league+"/athletes/"+athleteId+"/gamelog?season=2026"):null;
 console.log("SOCCERDEEP "+JSON.stringify({league,game:game.id,
  summaryKeys:Object.keys(summary),boxKeys:Object.keys(box),
  boxSummary:JSON.stringify(box).slice(0,2500),
  rosterKeys:Object.keys(rosters),rosterSample:JSON.stringify(rosters).slice(0,2600),
  lineupSample:JSON.stringify(summary.lineups||summary.rosters||summary.players||{}).slice(0,2500),
  firstAthlete:athlete&&{id:athlete.id,name:athlete.fullName,position:athlete.position,
   statsKeys:Object.keys(athlete.statistics||{})},
  athleteLogKeys:Object.keys(log||{}),athleteLogSample:JSON.stringify(log).slice(0,1200)
 }).slice(0,10500));
 }catch(e){console.log("SOCCERDEEP ERROR "+league+" "+String(e).slice(0,500))}
}
