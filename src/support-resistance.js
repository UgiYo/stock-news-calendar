import {movingAverage} from './moving-average.js';
export function supportResistance(candles,periods=[5,20,60],{lookback=120,tolerance=.01}={}){
 const rows=candles.filter(r=>!r.partial),latest=rows.at(-1);if(rows.length<60)return [];
 const window=rows.slice(-Math.max(60,lookback)),points=[];
 for(const r of window)for(const field of ['open','high','low','close'])if(Number.isFinite(r[field])&&r[field]>0)points.push({price:r[field],field,row:r,index:candles.indexOf(r)});
 points.sort((a,b)=>a.price-b.price);const clusters=[];
 for(const point of points){let group=clusters.at(-1);if(!group||(point.price-group[0].price)/group[0].price>tolerance){group=[];clusters.push(group);}group.push(point);}
 const averages=periods.map(period=>{const values=movingAverage(rows,period);return {period,value:values.at(-1),prior:values.at(-4)};});
 return clusters.flatMap(group=>{
  const days=[...new Set(group.map(p=>p.row))];if(days.length<3||group.length<4)return [];
  const low=group[0].price,high=group.at(-1).price,mid=(low+high)/2,type=high<latest.close?'support':low>latest.close?'resistance':null;if(!type)return [];
  const volumes=days.flatMap(r=>{const i=rows.indexOf(r),prior=rows.slice(i-20,i);if(prior.length<20||!Number.isFinite(r.volume)||r.volume<=0||prior.some(p=>!Number.isFinite(p.volume)||p.volume<0))return [];const mean=prior.reduce((n,p)=>n+p.volume,0)/20;return mean>0&&r.volume/mean>=1.5?[{date:r.start,ratio:r.volume/mean}]:[];});
  const ma=averages.filter(a=>a.value!=null&&a.prior!=null&&a.value>=low*.99&&a.value<=high*1.01).map(a=>`MA${a.period} ${a.value>a.prior?'上彎':a.value<a.prior?'下彎':'持平'}`);
  const counts=Object.fromEntries(['open','high','low','close'].map(f=>[f,group.filter(p=>p.field===f).length]));
  const evidence=group.map(p=>({date:p.row.start,field:p.field,price:p.price}));
  return [{low,high,mid,type,index:Math.min(...group.map(p=>p.index)),days:days.length,hits:group.length,counts,evidence,volumeDays:volumes.length,ma,from:window[0].start,to:latest.start,lookback:window.length,label:`${days.length} 個交易日／${group.length} 個相近價位（開 ${counts.open}、高 ${counts.high}、低 ${counts.low}、收 ${counts.close}）；${volumes.length?'其中 '+volumes.length+' 日出量':'未有符合門檻的出量佐證'}${ma.length?'；'+ma.join('、'):''}`}];
 }).sort((a,b)=>a.type.localeCompare(b.type)||Math.abs(a.mid-latest.close)-Math.abs(b.mid-latest.close));
}
export function referenceOverlay(levels,{x,y,right,left,offset}){
 return `<defs><clipPath id="support-price-clip"><rect x="${left}" y="20" width="${right-left}" height="205"/></clipPath></defs><g class="support-resistance-overlay" clip-path="url(#support-price-clip)" pointer-events="none">${levels.map(l=>{const color=l.type==='support'?'#087f5b':'#b45309',label=l.type==='support'?'支撐':'壓力',start=Math.max(left,x(Math.max(0,l.index-offset)));return `<rect x="${start}" y="${y(l.high)}" width="${Math.max(0,right-start)}" height="${Math.max(2,y(l.low)-y(l.high))}" fill="${color}" opacity=".12"/><line x1="${start}" x2="${right}" y1="${y(l.mid)}" y2="${y(l.mid)}" stroke="${color}" stroke-dasharray="7 4"/>`;}).join('')}</g>`;
}
