/**
 * Real-data smoke test. Runs against the deployed site, never mocks ESPN.
 * Example: BASE_URL=https://matchup-nightmare-v2.pages.dev node tests/live-espn-smoke.mjs
 */
import {chromium} from "playwright";
const BASE=(process.env.BASE_URL||"https://matchup-nightmare-v2.pages.dev").replace(/\/$/,"");
const DATE=process.env.GAME_DATE||"2026-10-11";
const SPORT="nfl";
const failures=[];
const stamp=()=>new Date().toISOString();
function record(label,ok,details={}){
  console.log(JSON.stringify({time:stamp(),label,ok,...details}));
  if(!ok)failures.push(label+": "+(details.error||details.message||"failed"));
}
async function get(path){
  const url=BASE+path;
  const response=await fetch(url,{headers:{Accept:"application/json"},signal:AbortSignal.timeout(25000)});
  const type=response.headers.get("content-type")||"";
  const body=await response.text();
  let json;
  try{json=JSON.parse(body)}catch{throw Error(url+" HTTP "+response.status+" non-JSON "+type+" "+body.slice(0,100))}
  if(!response.ok)throw Error(url+" HTTP "+response.status+" "+JSON.stringify(json).slice(0,350));
  return {json,status:response.status,type,bytes:body.length};
}
const query=p=>"/api/espn?"+new URLSearchParams(p);
let game=null,team=null,season=2026;
try{
  const h=await get("/api/health");
  record("live health JSON",h.json.ok===true&&h.json.recommendedSourceRoute==="/api/espn",{status:h.status,mode:h.json.historyAssembly});
}catch(e){record("live health JSON",false,{error:e.message})}
try{
  const g=await get("/api/games?sport="+SPORT+"&date="+DATE);
  game=g.json.games?.find(x=>x.home?.id&&x.away?.id);
  team=game?.home;
  season=game?.season||2026;
  record("ESPN real NFL schedule",Boolean(game),{date:DATE,game:game&&{id:game.id,away:game.away.name,home:game.home.name,season},count:g.json.games?.length,source:g.json.source});
}catch(e){record("ESPN real NFL schedule",false,{error:e.message})}
let schedule=null,roster=null,summary=null,gamelog=null,player=null,completed=null;
if(team){
  try{
    const s=await get(query({sport:SPORT,kind:"schedule",teamId:team.id,season}));
    schedule=s.json;
    const events=Array.isArray(schedule.events)?schedule.events:[];
    completed=events.filter(e=>e.id&&new Date(e.date)<new Date(game.date)&&(/final/i.test(e.competitions?.[0]?.status?.type?.name||"")||/final/i.test(e.status?.type?.name||"")||e.competitions?.[0]?.status?.type?.completed===true)).sort((a,b)=>Date.parse(b.date)-Date.parse(a.date))[0];
    if(!completed)completed=events.filter(e=>e.id&&new Date(e.date)<new Date(game.date)).sort((a,b)=>Date.parse(b.date)-Date.parse(a.date))[0];
    record("ESPN team schedule document",events.length>0&&Boolean(completed),{team:team.name,events:events.length,completedGame:completed?.id,bytes:s.bytes});
  }catch(e){record("ESPN team schedule document",false,{error:e.message})}
  try{
    const r=await get(query({sport:SPORT,kind:"roster",teamId:team.id,season}));
    roster=r.json;
    const groups=roster.athletes||[];
    const athletes=groups.flatMap(g=>Array.isArray(g.items)?g.items:Array.isArray(g.athletes)?g.athletes:Array.isArray(g)?g:[]);
    player=athletes.find(a=>a.id&&a.position?.abbreviation)||athletes.find(a=>a.id);
    record("ESPN position-tagged roster document",athletes.length>0&&Boolean(player?.position),{team:team.name,players:athletes.length,player:player&&{id:player.id,name:player.displayName,position:player.position?.abbreviation},bytes:r.bytes});
  }catch(e){record("ESPN position-tagged roster document",false,{error:e.message})}
  if(completed){
    try{
      const s=await get(query({sport:SPORT,kind:"summary",gameId:completed.id}));
      summary=s.json;
      const box=summary.boxscore?.players||[];
      record("ESPN completed-game boxscore document",box.length>0,{gameId:completed.id,teamSections:box.length,bytes:s.bytes});
    }catch(e){record("ESPN completed-game boxscore document",false,{error:e.message})}
  }
  if(player){
    try{
      const g=await get(query({sport:SPORT,kind:"gamelog",playerId:player.id,season}));
      gamelog=g.json;
      const payload=JSON.stringify(gamelog);
      record("ESPN athlete career game-log document",payload.length>200&&/events|seasonTypes|categories|labels/i.test(payload),{player:player.displayName,playerId:player.id,bytes:g.bytes,keys:Object.keys(gamelog).slice(0,12)});
    }catch(e){record("ESPN athlete career game-log document",false,{error:e.message})}
  }
}
let browser;
try{
  browser=await chromium.launch({headless:true,args:["--no-sandbox"]});
  const page=await browser.newPage({viewport:{width:1440,height:900}});
  const errors=[],api=[];
  page.on("pageerror",e=>errors.push(e.message));
  page.on("response",r=>{if(r.url().includes("/api/"))api.push({status:r.status(),url:r.url().replace(BASE,"").slice(0,180)});});
  await page.goto(BASE,{waitUntil:"domcontentloaded",timeout:35000});
  await page.locator("#date").fill(DATE);
  await page.waitForTimeout(800);
  await page.waitForFunction(()=>document.querySelectorAll("#games button").length>0,{timeout:45000});
  const first=page.locator("#games button").first();
  const title=(await first.innerText()).replace(/\s+/g," ").slice(0,130);
  await first.click();
  await page.locator("#scanSelected").click();
  console.log(JSON.stringify({time:stamp(),label:"browser scan started",game:title,date:DATE}));
  await page.waitForFunction(()=>document.querySelector("#scanProgress")?.textContent?.includes("Scan complete:"),null,{timeout:540000});
  const result=await page.evaluate(()=>{
    const cards=[...document.querySelectorAll(".scan-card")];
    const rows=[...document.querySelectorAll(".scan-card")].map(c=>({
      text:c.innerText.slice(0,1800),
      recent:c.querySelectorAll(".recent-history .game-history-row,.recent-history tr,.game-log-row").length,
      similar:c.querySelectorAll(".similar-history tr,.similar-history .game-history-row,.similar-history .game-log-row").length
    }));
    return {progress:document.querySelector("#scanProgress")?.textContent,
      output:document.querySelector("#scanOutput")?.innerText.slice(0,2600),
      cardCount:cards.length,firstCard:rows[0]||null,
      allCardText:cards.slice(0,5).map(c=>c.innerText.slice(0,900))};
  });
  const hadRecent=/Recent 5 Games — Current Season Only/.test(result.firstCard?.text||"");
  const hadSimilar=/similar defenses|similar-defense|matchup trend|Last 4/i.test(result.firstCard?.text||"");
  const sourceFailures=api.filter(r=>r.status>=400);
  const browserPass=result.cardCount>0&&hadRecent&&hadSimilar&&errors.length===0&&sourceFailures.length===0;
  record("LIVE browser-assembled Recent 5 + three-season matchup scan",browserPass,
    {game:title,cardCount:result.cardCount,hadRecent,hadSimilar,
      errors:errors.slice(0,6),sourceFailures:sourceFailures.slice(0,8),apiCalls:api.length,
      progress:result.progress,firstCard:result.firstCard,output:result.output});
  await page.screenshot({path:"live-espn-scan.png",fullPage:true}).catch(()=>{});
}catch(e){record("LIVE browser-assembled Recent 5 + three-season matchup scan",false,{error:e.message})}
finally{await browser?.close().catch(()=>{})}
console.log(JSON.stringify({time:stamp(),label:"FINAL",pass:failures.length===0,failures}));
if(failures.length)process.exitCode=1;
