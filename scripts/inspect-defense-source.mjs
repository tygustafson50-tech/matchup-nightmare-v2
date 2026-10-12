const urls=[
  "https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams/14/statistics?season=2026",
  "https://sports.core.api.espn.com/v2/sports/football/leagues/nfl/seasons/2026/types/2/teams/14/statistics",
  "https://site.api.espn.com/apis/site/v2/sports/football/nfl/statistics?season=2026",
  "https://www.footballdb.com/statistics/nfl/team-stats/defense-totals/2026/regular-season",
  "https://www.nfl.com/stats/team-stats/defense/passing/2026/reg/all"
];
for(const url of urls){
  try{
    const res=await fetch(url,{signal:AbortSignal.timeout(12000)});
    const raw=await res.text(),type=res.headers.get("content-type")||"";
    let body=null;
    try{body=JSON.parse(raw);}catch{}
    const found=[];
    const visit=(v,path,depth)=>{
      if(depth>4||found.length>60||!v||typeof v!=="object")return;
      for(const [k,value] of Object.entries(v)){
        if(/defen|pass|rush|allow|oppon|team|category|splits/i.test(k)&&found.length<60)
          found.push([path+"."+k,typeof value==="object"?"(object)":String(value).slice(0,55)]);
        if(typeof value==="object"&&value&&depth<4)visit(value,path+"."+k,depth+1);
      }
    };
    if(body)visit(body,"root",0);
    const report={url,status:res.status,type,bytes:raw.length,
      jsonKeys:Object.keys(body||{}).slice(0,20),
      fields:found.slice(0,55),
      snippet:body?undefined:raw.replace(/\s+/g," ").slice(0,600)};
    console.log(JSON.stringify(report));
  }catch(e){console.log(JSON.stringify({url,error:String(e).slice(0,250)}))}
}
