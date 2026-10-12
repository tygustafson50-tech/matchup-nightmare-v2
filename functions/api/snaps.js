/**
 * Public nflverse snap counts, proxied through the same-origin Pages Function.
 * Only a validated season is accepted. Data remains sourced from nflverse,
 * not guessed from targets, touchdowns or a player's roster designation.
 */
export async function onRequestGet({request}){
  const season=new URL(request.url).searchParams.get("season")||"";
  if(!/^20(?:1[2-9]|2[0-9])$/.test(season))
    return new Response("Invalid NFL season",{status:400});
  const url="https://github.com/nflverse/nflverse-data/releases/download/snap_counts/snap_counts_"+
    season+".csv";
  try{
    const response=await fetch(url,{
      headers:{"Accept":"text/csv"},
      redirect:"follow"
    });
    if(!response.ok)return new Response("NFL snap count source unavailable",{status:502});
    return new Response(response.body,{
      status:200,headers:{
        "content-type":"text/csv; charset=utf-8",
        "cache-control":"public, max-age=1800",
        "x-content-type-options":"nosniff",
        "x-nfl-snaps-source":"nflverse/pfr"
      }
    });
  }catch{
    return new Response("NFL snap count source unavailable",{status:502});
  }
}
