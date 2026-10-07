export function chainMemberships(catalog,code){return (catalog?.groups||[]).filter(g=>g.codes.includes(code));}
const flowCache=new WeakMap(),emptyPrevious={};
export function chainFlows(catalog,rows,previous){
 const cacheable=!!catalog&&typeof catalog==='object'&&Array.isArray(rows);
 let cachedFlows=null,previousKey=previous&&typeof previous==='object'?previous:emptyPrevious;
 if(cacheable){let byRows=flowCache.get(catalog);if(!byRows){byRows=new WeakMap();flowCache.set(catalog,byRows);}let byPrevious=byRows.get(rows);if(!byPrevious){byPrevious=new WeakMap();byRows.set(rows,byPrevious);}cachedFlows=byPrevious.get(previousKey);if(cachedFlows)return cachedFlows;}
 const total=rows.reduce((s,r)=>s+r.amount,0),priorTotal=previous?.reduce((s,r)=>s+r.amount,0),byCode=new Map(rows.map(r=>[r.code,r])),prior=new Map((previous||[]).map(r=>[r.code,r]));
 const result=(catalog?.groups||[]).map(g=>{const members=g.codes.map(c=>byCode.get(c)).filter(Boolean),amount=members.reduce((s,r)=>s+r.amount,0),before=g.codes.reduce((s,c)=>s+(prior.get(c)?.amount||0),0),share=total?amount/total*100:0,change=previous&&priorTotal?share-before/priorTotal*100:null;return {...g,members,amount,share,change};}).filter(g=>g.members.length).sort((a,b)=>b.amount-a.amount||a.id.localeCompare(b.id));if(cacheable){const byRows=flowCache.get(catalog),byPrevious=byRows.get(rows);byPrevious.set(previousKey,result);}return result;
}
export function pearson(a,b){if(a.length<15||a.length!==b.length)return null;const avg=x=>x.reduce((s,v)=>s+v,0)/x.length,ma=avg(a),mb=avg(b);let cov=0,va=0,vb=0;for(let i=0;i<a.length;i++){cov+=(a[i]-ma)*(b[i]-mb);va+=(a[i]-ma)**2;vb+=(b[i]-mb)**2;}return va&&vb?cov/Math.sqrt(va*vb):null;}
const chainSignalCache=new WeakMap(),noPreviousSignals={};
export function watchChainSignals(catalog,rows,previous,history,tracked,date){
 let memo=null;
 if(catalog&&rows&&history&&tracked){
  let rowsMap=chainSignalCache.get(catalog);if(!rowsMap){rowsMap=new WeakMap();chainSignalCache.set(catalog,rowsMap);}
  let previousMap=rowsMap.get(rows);if(!previousMap){previousMap=new WeakMap();rowsMap.set(rows,previousMap);}
  const previousKey=previous&&typeof previous==='object'?previous:noPreviousSignals;
  let historyMap=previousMap.get(previousKey);if(!historyMap){historyMap=new WeakMap();previousMap.set(previousKey,historyMap);}
  let trackedMap=historyMap.get(history);if(!trackedMap){trackedMap=new WeakMap();historyMap.set(history,trackedMap);}
  let dateMap=trackedMap.get(tracked);if(!dateMap){dateMap=new Map();trackedMap.set(tracked,dateMap);}
  if(dateMap.has(date))return dateMap.get(date);memo={dateMap,date};
 }
 const flows=chainFlows(catalog,rows,previous),byCode=new Map(rows.map(r=>[r.code,r]));
 const result=tracked.map(stock=>{const matching=flows.filter(g=>g.codes.includes(stock.code));const links=matching.map(g=>{const points=(history||[]).filter(h=>h.date<=date&&h.turnover).sort((a,b)=>a.date.localeCompare(b.date)).slice(-31),values=[];for(const h of points){const map=new Map(h.turnover),own=map.get(stock.code),total=h.total;if(own==null||!total)continue;const peers=g.codes.filter(c=>c!==stock.code&&map.has(c));if(peers.length<2)continue;values.push({date:h.date,prior:h.previousDate,own:own/total*100,peers:peers.reduce((s,c)=>s+map.get(c),0)/total*100});}const a=[],b=[];for(let i=1;i<values.length;i++)if(values[i].prior===values[i-1].date){a.push(values[i].own-values[i-1].own);b.push(values[i].peers-values[i-1].peers);}const correlation=pearson(a,b),peerCount=g.members.filter(r=>r.code!==stock.code).length,currentTotal=rows.reduce((s,r)=>s+r.amount,0),priorTotal=previous?.reduce((s,r)=>s+r.amount,0),ownAmount=byCode.get(stock.code)?.amount||0,priorOwn=previous?.find(r=>r.code===stock.code)?.amount||0,peerShare=currentTotal?(g.amount-ownAmount)/currentTotal*100:0,peerChange=g.change==null||!priorTotal?null:g.change-ownAmount/currentTotal*100+priorOwn/priorTotal*100,hot=peerShare>=2&&peerChange!=null&&peerChange>=0.3&&peerCount>=2;return {...g,peerShare,peerChange,correlation,samples:a.length,hot,high:hot&&correlation!=null&&correlation>=0.6};}).sort((a,b)=>Number(b.high)-Number(a.high)||Number(b.hot)-Number(a.hot)||b.amount-a.amount);return {...stock,amount:byCode.get(stock.code)?.amount??null,links};});if(memo)memo.dateMap.set(memo.date,result);return result;
}

export function capRanking(codes,stocks,marketCaps){
 const universe=new Set(stocks.filter(s=>codes.includes(s.code)).map(s=>s.code)),caps=new Map((marketCaps?.stocks||[]).map(s=>[s.code,s]));
 const members=[...universe].map(code=>caps.get(code)).filter(s=>s&&Number.isFinite(s.value)&&s.value>0).sort((a,b)=>b.value-a.value||a.code.localeCompare(b.code));
 return {date:marketCaps?.date,members,covered:members.length,total:universe.size,leaders:members.slice(0,3).map((s,i)=>({...s,rank:i+1,role:['市值龍頭','市值老二','市值老三'][i]}))};
}
const industryCatalogCache=new WeakMap();
export function industryCatalog(catalog){
 if(catalog&&typeof catalog==='object'&&industryCatalogCache.has(catalog))return industryCatalogCache.get(catalog);
 const groups=new Map();for(const g of catalog?.groups||[]){if(!groups.has(g.industry))groups.set(g.industry,{id:'industry:'+g.industry,industry:g.industry,name:'全產業',codes:[]});groups.get(g.industry).codes.push(...g.codes);}
 const result={groups:[...groups.values()].map(g=>({...g,codes:[...new Set(g.codes)]}))};if(catalog&&typeof catalog==='object')industryCatalogCache.set(catalog,result);return result;
}
