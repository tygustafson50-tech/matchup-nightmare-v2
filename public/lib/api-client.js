/**
 * Cloudflare Pages API response validator.
 * An HTML fallback/error page is NOT an empty set of sports statistics.
 */
export async function parseApiResponse(response,endpoint="API"){
  if(!response||typeof response.text!=="function")
    throw Error(endpoint+": no readable server response.");
  const type=String(response.headers?.get?.("content-type")||"").toLowerCase();
  const code=Number(response.status)||0;
  const text=await response.text();
  if(!/\bjson\b|\+json/.test(type) || !text.trim().startsWith("{")){
    const html=/<!doctype\s+html|<html[\s>]/i.test(text.slice(0,600));
    const reason=html
      ?"Cloudflare returned its website or an HTML error page instead of the statistics API."
      :"The statistics API returned an unexpected response format.";
    throw Error(endpoint+": "+reason+
      " HTTP "+(code||"unknown")+". No games or OVER trends were verified. "+
      "Check the Cloudflare Pages Functions deployment and /api/health.");
  }
  let data;
  try{data=JSON.parse(text);}catch{
    throw Error(endpoint+": received malformed JSON (HTTP "+code+"). The scan was not completed.");
  }
  if(!response.ok){
    const message=[data?.error,data?.details].filter(Boolean).map(String).join(" — ")||
      "Source returned HTTP "+code;
    throw Error(endpoint+": "+message.slice(0,260));
  }
  return data;
}
