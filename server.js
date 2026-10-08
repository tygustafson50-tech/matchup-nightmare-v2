import http from "node:http";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {readFile} from "node:fs/promises";
const dir=path.dirname(fileURLToPath(import.meta.url));
const sports={nfl:["football","nfl"],nba:["basketball","nba"],mlb:["baseball","mlb"],ncaaf:["football","college-football"],ncaab:["basketball","mens-college-basketball"],soccer:["soccer","eng.1"]};
const leagues=new Set(["eng.1","esp.1","ger.1","ita.1","fra.1","usa.1","uefa.champions"]);
const cache=new Map();
function send(res,code,data,type="application/json"){res.writeHead(code,{"content-type":type,"x-content-type-options":"nosniff"});res.end(typeof data==="string"||Buffer.isBuffer(data)?data:JSON.stringify(data));}
http.createServer(async(req,res)=>{try{
if(req.method!=="GET")return send(res,405,{error:"GET only"});
const u=new URL(req.url||"/","http://localhost");
if(u.pathname==="/api/games"){
 const key=u.searchParams.get("sport")||"nfl",date=u.searchParams.get("date")||new Date().toISOString().slice(0,10);
 if(!Object.hasOwn(sports,key))return send(res,400,{error:"Invalid sport"});
 if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||Number.isNaN(Date.parse(date)))return send(res,400,{error:"Invalid date"});
 const league=key==="soccer"?(u.searchParams.get("league")||"eng.1"):sports[key][1];
 if(key==="soccer"&&!leagues.has(league))return send(res,400,{error:"Invalid league"});
 const endpoint="https://site.api.espn.com/apis/site/v2/sports/"+sports[key][0]+"/"+league+"/scoreboard?dates="+date.replaceAll("-","")+"&limit=100";
 let payload=cache.get(endpoint);if(!payload||Date.now()-payload.stamp>60000){
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),9000);let r;
 try{r=await fetch(endpoint,{signal:controller.signal});}finally{clearTimeout(timer);}
 if(!r.ok)throw Error("Schedule source returned "+r.status);
 const raw=await r.json();
 const games=(raw.events||[]).map(e=>{const c=e.competitions?.[0]?.competitors||[],away=c.find(x=>x.homeAway==="away"),home=c.find(x=>x.homeAway==="home");if(!away||!home)return null;return{id:String(e.id),date:e.date,status:e.status?.type?.description||"Scheduled",home:{name:home.team?.displayName||"Home",logo:home.team?.logo||""},away:{name:away.team?.displayName||"Away",logo:away.team?.logo||""}};}).filter(Boolean);
 payload={stamp:Date.now(),data:{games,date,sport:key,source:"ESPN public scoreboard (unofficial)",oddsConnected:false}};cache.set(endpoint,payload);
 }
 return send(res,200,payload.data);
}
const rel=u.pathname==="/"?"index.html":decodeURIComponent(u.pathname).slice(1);
const base=rel.startsWith("lib/")?dir:path.join(dir,"public");
const file=path.resolve(base,rel);
if(!file.startsWith(base+path.sep))return send(res,403,{error:"Forbidden"});
const type={".html":"text/html; charset=utf-8",".js":"text/javascript; charset=utf-8",".css":"text/css; charset=utf-8"}[path.extname(file)]||"text/plain";
return send(res,200,await readFile(file),type);
}catch(e){return send(res,e.code==="ENOENT"?404:502,{error:"Unavailable",details:String(e.message).slice(0,160)});}
}).listen(Number(process.env.PORT||3000),"0.0.0.0",()=>console.log("Matchup Nightmare: http://localhost:"+(process.env.PORT||3000)));
