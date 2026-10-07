import {topTurnover} from './ranking.js';
const sectorTrendCache=new WeakMap();
export function newEntrants(rows,previous){if(!previous)return null;const codes=new Set(topTurnover(previous).map(r=>r.code));return new Set(topTurnover(rows).filter(r=>!codes.has(r.code)).map(r=>r.code));}
export function sectorTrend(history,tag,anchor){
 if(!Array.isArray(history))return [];
 let cache=sectorTrendCache.get(history);if(!cache){cache=new Map();sectorTrendCache.set(history,cache);}
 const key=tag+'\u0000'+anchor;if(cache.has(key))return cache.get(key);
 const sorted=[...history].sort((a,b)=>a.date.localeCompare(b.date));
 const rows=sorted.map(h=>{const sector=h.sectors?.[tag]||{amount:0,count:0,topCount:0};return {...sector,date:h.date,previousDate:h.previousDate,share:h.total>0?sector.amount/h.total*100:null};});
 const byDate=new Map(rows.map(r=>[r.date,r]));
 const result=rows.map(r=>{const prior=byDate.get(r.previousDate),change=prior&&r.share!==null&&prior.share!==null?r.share-prior.share:null;return {...r,change,afterAnchor:r.date>=anchor};});
 cache.set(key,result);if(cache.size>100)cache.delete(cache.keys().next().value);return result;
}
