export function rankingReturns(prices,date,dates){
 const sessions=[...new Set((dates||[]).filter(d=>d<=date))].sort().reverse(),byDate=new Map((prices||[]).filter(p=>Number.isFinite(p.close)&&p.close>0).map(p=>[p.date,p.close])),close=byDate.get(date);
 return Object.fromEntries([1,5,10].map(n=>{const baseline=sessions[n],prior=baseline?byDate.get(baseline):null;return [n,{date:baseline||null,value:close!=null&&prior!=null?(close/prior-1)*100:null}];}));
}
export function returnCell(result,loading=false){
 const value=result?.value;return value==null?`<span class="price-missing">${loading?'載入中…':'資料不足'}</span>`:`<span class="price-return ${value>0?'price-up':value<0?'price-down':'price-flat'}">${value>0?'+':''}${value.toFixed(2)}%</span>`;
}
