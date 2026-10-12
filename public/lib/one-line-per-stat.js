/**
 * One player / statistical market / scheduled game = exactly one displayed
 * OVER line. PropLine can quote several sportsbooks and ALT points for the
 * same player/stat; all are real but should not become duplicate cards.
 *
 * We examine every available market line against ONE shared, verified set
 * of historical game data, then select the strongest supported quote.
 */
const canonicalName=name=>String(name||"").normalize("NFKD")
  .replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]/g,"");
const finite=x=>typeof x==="number"&&Number.isFinite(x);

export function groupOffersByPlayerStat(pairs){
  const groups=new Map();
  for(const item of pairs||[]){
    const {offer,game}=item||{};
    const player=canonicalName(offer?.player),stat=String(offer?.stat||"");
    if(!player||!stat||!game?.id||!offer?.id)continue;
    const key=[String(offer.sport),String(game.id),player,stat].join("|");
    if(!groups.has(key))groups.set(key,{
      key,game,offers:[],verifiedIds:new Set()
    });
    const group=groups.get(key);
    if(offer.espnPlayerId)group.verifiedIds.add(String(offer.espnPlayerId));
    // No exact duplicate provider quote should be analyzed twice.
    if(!group.offers.some(o=>o.id===offer.id))group.offers.push(offer);
  }
  return [...groups.values()].map(({verifiedIds,...group})=>({
    ...group,identityConflict:verifiedIds.size>1
  }));
}
function quoteTier(card){
  const recent=card?.recent||{},similar=card?.similar||{};
  const fullRecent=recent.tracked===5&&recent.hits===5;
  const fullSimilar=similar.tracked>=3&&similar.tracked===similar.hits;
  if(fullRecent&&fullSimilar)return 4;
  if(card?.recommendation==="OVER"&&recent.tracked>=3&&similar.tracked>=3)return 3;
  if(recent.tracked>=3&&similar.tracked>=3)return 2;
  if(recent.tracked>=1&&similar.tracked>=1)return 1;
  return 0;
}
function observedRate(card){
  const a=card?.recent||{},b=card?.similar||{};
  const r=a.tracked>0?a.hits/a.tracked:0;
  const m=b.tracked>0?b.hits/b.tracked:0;
  // Same real player/history within a group. Weight matching defenses more,
  // but never interpret these observed rates as probabilities of success.
  return r*.45+m*.55;
}
export function compareOverEvidence(a,b){
  // > 0 means 'a' is preferred. No projected outcomes, fabricated lines
  // or synthetic confidence multipliers are used to choose a card.
  let d=quoteTier(a)-quoteTier(b);
  if(d)return d;
  d=observedRate(a)-observedRate(b);
  if(Math.abs(d)>1e-9)return d;
  d=(a?.similar?.tracked||0)-(b?.similar?.tracked||0);
  if(d)return d;
  d=(a?.recent?.tracked||0)-(b?.recent?.tracked||0);
  if(d)return d;
  // When samples are identical and both points have the same verified hit
  // rate, prefer the HIGHEST actual OVER line they both support.
  d=(finite(a?.line)?a.line:-Infinity)-(finite(b?.line)?b.line:-Infinity);
  if(d)return d;
  // The same point quoted by multiple books: prefer better real American odds.
  d=(finite(a?.price)?a.price:-Infinity)-(finite(b?.price)?b.price:-Infinity);
  if(d)return d;
  d=(Date.parse(a?.quotedAt)||0)-(Date.parse(b?.quotedAt)||0);
  if(d)return d;
  return String(b?.id||"").localeCompare(String(a?.id||""));
}
export function selectBestOverCard(cards){
  const valid=(cards||[]).filter(c=>c&&finite(c.line)&&c.line>=0);
  if(!valid.length)return null;
  const winner=valid.reduce((best,card)=>!best||compareOverEvidence(card,best)>0?
    card:best,null);
  return {...winner,quotesConsidered:valid.length};
}
export function dedupeVerifiedCards(cards){
  // Defense in depth: a player might have source-specific name spellings,
  // yet resolve to one official ESPN athlete ID after roster verification.
  const map=new Map();
  for(const card of cards||[]){
    if(!card)continue;
    const officialId=String(card.offer?.espnPlayerId||"");
    const player=officialId?"espn:"+officialId:canonicalName(card.player);
    // Normalize to the ACTUAL selected ESPN fixture instead of trusting
    // sportsbook-specific provider event IDs, which may differ between
    // main and alternative ladders for the exact same game.
    const fixture=String(card.fixtureId||card.selectedGameId||
      card.offer?.gameId||card.offer?.providerEventId||
      card.date+"|"+card.team+"|"+card.opponent);
    const key=[card.sport,fixture,player,card.stat].join("|");
    const previous=map.get(key);
    const best=selectBestOverCard(previous?[previous,card]:[card]);
    if(best)map.set(key,{
      ...best,quotesConsidered:previous
        ?(previous.quotesConsidered||1)+(card.quotesConsidered||1)
        :(card.quotesConsidered||1)
    });
  }
  return [...map.values()];
}
