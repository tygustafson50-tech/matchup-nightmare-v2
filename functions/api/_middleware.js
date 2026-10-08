/**
 * Every Pages API endpoint must return JSON, including missing routes,
 * unexpected upstream crashes and static-SPA fallthroughs.
 * No API HTML may be passed to browser JSON consumers.
 */
function fail(message,status=502,details=null){
  return new Response(JSON.stringify({
    error:message,details,
    picksVerified:false,
    scanCompleted:false
  }),{
    status,
    headers:{"content-type":"application/json; charset=utf-8",
      "cache-control":"no-store","x-content-type-options":"nosniff"}
  });
}
export async function onRequest(context){
  try{
    const response=await context.next();
    const type=response.headers.get("content-type")||"";
    if(!/^(application\/json|[^;]+\+json)(;|$)/i.test(type)){
      return fail(
        "The Cloudflare API returned a webpage instead of statistics. No betting trends were analyzed.",
        response.status>=400?response.status:503,
        "Expected JSON at "+new URL(context.request.url).pathname+
        "; received "+(type||"unknown content type")+
        ", HTTP "+response.status+
        ". Check Cloudflare Pages Functions deployment and runtime logs."
      );
    }
    return response;
  }catch(error){
    return fail("Matchup analysis API failed before completing the scan.",502,
      String(error?.message||error).slice(0,220));
  }
}
