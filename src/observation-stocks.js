// Transparent turnover screening; no price prediction or invented financial facts.
export function selectObservationStocks(trends,stocks=[],tracked=[]){
 const names=new Map(stocks.map(s=>[s.code,s.name])),watch=new Set(tracked.map(s=>s.code)),best=new Map();
 for(const g of trends){
  if(g.series.length<10||g.comparisons<8||!['持續升溫','近期轉強'].includes(g.label))continue;
  for(const r of g.members){
   if(!r.complete||!names.has(r.code)||![r.delta,r.amount,r.before,r.after,g.delta].every(Number.isFinite)||r.delta<0.05||r.amount<1e8)continue;
   const peers=g.members.filter(p=>p.code!==r.code&&p.complete&&p.delta>0),peerDelta=g.delta-r.delta;
   if(peers.length<2||peerDelta<0.3)continue;
   const candidate={...r,name:names.get(r.code),tracked:watch.has(r.code),groupId:g.id,industry:g.industry,groupName:g.name,groupLabel:g.label,groupDelta:g.delta,peerDelta,peerCount:peers.length};
   const existing=best.get(r.code);if(!existing||candidate.peerDelta>existing.peerDelta||(candidate.peerDelta===existing.peerDelta&&candidate.groupId.localeCompare(existing.groupId)<0))best.set(r.code,candidate);
  }
 }
 const ordered=[...best.values()].sort((a,b)=>Number(b.tracked)-Number(a.tracked)||b.delta-a.delta||b.peerDelta-a.peerDelta||b.amount-a.amount||a.code.localeCompare(b.code)),result=[],industries=new Set();
 for(const candidate of ordered){if(industries.has(candidate.industry))continue;result.push(candidate);industries.add(candidate.industry);if(result.length===3)break;}
 return result;
}
