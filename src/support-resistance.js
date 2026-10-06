import {movingAverage} from './moving-average.js';
export function supportResistance(candles,periods=[5,20,60]){
 const rows=candles.filter(r=>!r.partial),latest=rows.at(-1);if(!latest)return [];
 const candidates=[];const add=(low,high,index,label,weight)=>{if(![low,high].every(Number.isFinite))return;const mid=(low+high)/2,type=high<latest.close?'support':low>latest.close?'resistance':null;if(type)candidates.push({low,high,mid,type,index,label,weight});};
 for(let i=Math.max(20,rows.length-60);i<rows.length;i++){
  const r=rows[i],prior=rows.slice(i-20,i);if(!Number.isFinite(r.volume)||r.volume<=0||prior.some(p=>!Number.isFinite(p.volume)||p.volume<0))continue;
  const mean=prior.reduce((n,p)=>n+p.volume,0)/20;if(!mean||r.volume/mean<1.5)continue;
  const ratio=r.volume/mean,idx=candles.indexOf(r),bodyLow=Math.min(r.open,r.close),bodyHigh=Math.max(r.open,r.close);
  add(r.low,bodyLow,idx,`${r.start} 出量 ${ratio.toFixed(1)} 倍・下影／實體下緣`,ratio);
  add(bodyHigh,r.high,idx,`${r.start} 出量 ${ratio.toFixed(1)} 倍・上影／實體上緣`,ratio);
 }
 for(const period of periods){const values=movingAverage(rows,period),last=values.at(-1),before=values.at(-4);if(last==null||before==null)continue;const slope=last-before,idx=candles.indexOf(latest);if(last<latest.close&&slope>0)add(last*.997,last*1.003,idx,`MA${period} 上彎・動態支撐`,2);if(last>latest.close&&slope<0)add(last*.997,last*1.003,idx,`MA${period} 下彎・動態壓力`,2);}
 const output=[];
 for(const type of ['support','resistance']){const list=candidates.filter(c=>c.type===type).sort((a,b)=>Math.abs(a.mid-latest.close)-Math.abs(b.mid-latest.close)||b.weight-a.weight);for(const c of list){const overlap=output.find(p=>p.type===type&&Math.abs(p.mid-c.mid)/p.mid<=.01);if(overlap){overlap.label+='；'+c.label;continue;}if(output.filter(p=>p.type===type).length<2)output.push({...c});}}
 return output;
}
export function referenceOverlay(levels,{x,y,right,left,offset}){
 return `<defs><clipPath id="support-price-clip"><rect x="${left}" y="20" width="${right-left}" height="205"/></clipPath></defs><g class="support-resistance-overlay" clip-path="url(#support-price-clip)" pointer-events="none">${levels.map(l=>{const color=l.type==='support'?'#087f5b':'#b45309',label=l.type==='support'?'支撐':'壓力',start=Math.max(left,x(Math.max(0,l.index-offset)));return `<rect x="${start}" y="${y(l.high)}" width="${Math.max(0,right-start)}" height="${Math.max(2,y(l.low)-y(l.high))}" fill="${color}" opacity=".12"/><line x1="${start}" x2="${right}" y1="${y(l.mid)}" y2="${y(l.mid)}" stroke="${color}" stroke-dasharray="7 4"/>`;}).join('')}</g>`;
}
