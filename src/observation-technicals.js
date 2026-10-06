// Fixed screening settings, not backtested return estimates. Use completed daily closes only.
export const OBSERVATION_RULES={periods:[5,10,20,60],maxBias5:5,maxBias20:10};
export function observationTechnical(prices,date){
 const rows=[...new Map(prices.filter(p=>/^\d{4}-\d{2}-\d{2}$/.test(p.date)&&p.date<=date).map(p=>[p.date,p])).values()].sort((a,b)=>a.date.localeCompare(b.date));
 if(rows.at(-1)?.date!==date)return {eligible:false,reason:'缺少所選交易日收盤價'};
 const window=rows.slice(-61);
 if(window.length<61||window.some(p=>!Number.isFinite(p.close)||p.close<=0))return {eligible:false,reason:'有效收盤價不足 61 個交易日'};
 const average=(n,offset=0)=>window.slice(-n-offset,offset?-offset:undefined).reduce((sum,p)=>sum+p.close,0)/n;
 const ma=Object.fromEntries(OBSERVATION_RULES.periods.map(n=>[n,average(n)])),close=window.at(-1).close;
 const bias5=(close/ma[5]-1)*100,bias20=(close/ma[20]-1)*100;
 const bull=ma[5]>ma[10]&&ma[10]>ma[20]&&ma[20]>ma[60];
 const rising=ma[20]>average(20,1)&&ma[60]>average(60,1);
 const reasons=[];
 if(!bull)reasons.push('未達 MA5 > MA10 > MA20 > MA60');
 if(!rising)reasons.push('MA20 或 MA60 未上揚');
 if(close<ma[5])reasons.push('收盤價低於 MA5');
 if(bias5>OBSERVATION_RULES.maxBias5||bias20>OBSERVATION_RULES.maxBias20)reasons.push('乖離過大');
 return {date,close,ma,bias5,bias20,bull,rising,eligible:!reasons.length,reason:reasons.join('；')};
}
