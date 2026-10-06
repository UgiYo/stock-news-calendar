const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function scatterScale(frames,ids){
 const points=frames.flatMap(f=>f.flows.filter(g=>ids.includes(g.id)&&Number.isFinite(g.share)&&Number.isFinite(g.change)));
 return {maxShare:Math.max(1,...points.map(g=>g.share))*1.12,maxChange:Math.max(0.1,...points.map(g=>Math.abs(g.change)))*1.2,maxAmount:Math.max(1,...points.map(g=>g.amount))};
}
export function scatterPoint(g,scale){return {x:66+g.share/scale.maxShare*470,y:176-g.change/scale.maxChange*136,r:5+Math.sqrt(Math.max(0,g.amount)/scale.maxAmount)*13};}
export function interpolateScatter(a,b,t){
 const progress=Math.max(0,Math.min(1,t));
 return Object.fromEntries(['x','y','r','heat'].map(k=>[k,(a[k]??0)+((b[k]??0)-(a[k]??0))*progress]));
}
function scatterColor(heat){
 const neutral=[113,132,147],target=heat>=0?[8,127,140]:[189,98,34],t=Math.min(1,Math.abs(heat));
 return `rgb(${neutral.map((v,i)=>Math.round(v+(target[i]-v)*t)).join(',')})`;
}
export function createTurnoverScatter(host,model,limit,onSelect){
 const ids=model.groups.slice(0,limit).map(g=>g.id),scale=scatterScale(model.frames,ids),names=new Map(model.groups.map(g=>[g.id,g.industry+'／'+g.name]));
 host.innerHTML=`<svg viewBox="0 0 600 380" class="turnover-scatter" role="group" aria-label="價值鏈成交占比與每日熱度變化散點圖"><text x="16" y="18">較前日占比變化（百分點）</text>${[-1,-0.5,0,0.5,1].map(v=>{const y=176-v*136;return `<line x1="66" x2="536" y1="${y}" y2="${y}" stroke="${v===0?'#82929c':'#e4eaee'}" ${v===0?'stroke-dasharray="5 4"':''}/><text x="58" y="${y+4}" text-anchor="end">${(v*scale.maxChange).toFixed(2)}</text>`;}).join('')}${[0,.25,.5,.75,1].map(v=>{const x=66+v*470;return `<line x1="${x}" x2="${x}" y1="40" y2="312" stroke="#e4eaee"/><text x="${x}" y="335" text-anchor="middle">${(v*scale.maxShare).toFixed(1)}%</text>`;}).join('')}<text x="310" y="367" text-anchor="middle">市場成交占比（%）→</text><text x="526" y="58" text-anchor="end" fill="#087f8c">升溫</text><text x="526" y="304" text-anchor="end" fill="#bd6222">降溫</text>${ids.map((id,i)=>`<g data-scatter-id="${esc(id)}" role="button" tabindex="0" aria-label="${esc(names.get(id))}" opacity="0" class="scatter-bubble"><circle cx="66" cy="176" r="6" stroke="white" stroke-width="2"/><text text-anchor="middle" dy="4" fill="white" pointer-events="none">${i+1}</text><title></title></g>`).join('')}</svg><p class="scatter-key">● 青綠：升溫　● 橘色：降溫　● 灰色：持平；點的面積隨成交值增加。</p><div class="scatter-choices">${ids.map((id,i)=>`<button data-scatter-choice="${esc(id)}">${i+1}. ${esc(names.get(id))}</button>`).join('')}</div><p data-scatter-missing role="status"></p>`;
 let current=new Map(),activeRows=new Map(),animation=0;
 const elements=new Map([...host.querySelectorAll('[data-scatter-id]')].map(el=>[el.dataset.scatterId,el]));
 const select=id=>{const g=activeRows.get(id);if(g)onSelect(g);};
 for(const [id,el] of elements){el.onclick=()=>select(id);el.onkeydown=e=>{if(['Enter',' '].includes(e.key)){e.preventDefault();select(id);}};}
 host.querySelectorAll('[data-scatter-choice]').forEach(b=>b.onclick=()=>select(b.dataset.scatterChoice));
 const paint=(id,p)=>{const el=elements.get(id);el.querySelector('circle').setAttribute('fill',scatterColor(p.heat));el.querySelector('circle').setAttribute('cx',p.x);el.querySelector('circle').setAttribute('cy',p.y);el.querySelector('circle').setAttribute('r',p.r);el.querySelector('text').setAttribute('x',p.x);el.querySelector('text').setAttribute('y',p.y);};
 return {update(frame,animate=false,onComplete=()=>{}){
  cancelAnimationFrame(animation);activeRows=new Map(frame.flows.filter(g=>ids.includes(g.id)&&Number.isFinite(g.change)&&Number.isFinite(g.share)).map(g=>[g.id,g]));
  const targets=new Map(),from=new Map(current);let missing=0;
  for(const [id,el] of elements){const g=activeRows.get(id);el.setAttribute('opacity',g?'0.88':'0');el.setAttribute('tabindex',g?'0':'-1');el.setAttribute('aria-hidden',g?'false':'true');el.style.pointerEvents=g?'auto':'none';if(!g){current.delete(id);missing++;continue;}
   const description=`${frame.date} ${names.get(id)}：成交值 ${(g.amount/1e8).toFixed(1)} 億，市場占比 ${g.share.toFixed(2)}%，較前日 ${g.change>=0?'+':''}${g.change.toFixed(2)} 個百分點`;
   el.querySelector('title').textContent=description;el.setAttribute('aria-label',description);targets.set(id,{...scatterPoint(g,scale),heat:Math.max(-1,Math.min(1,g.change/scale.maxChange*4))});
  }
  host.querySelectorAll('[data-scatter-choice]').forEach(b=>{b.disabled=!activeRows.has(b.dataset.scatterChoice);});
  host.querySelector('[data-scatter-missing]').textContent=missing?`${missing} 個細項缺少當日或前日比較資料，暫不畫點。`:'';
  const reduced=globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches,start=performance.now(),duration=animate&&!reduced?(typeof animate==='number'?animate:1800):0;
  const tick=now=>{if(!host.isConnected)return;const t=duration?Math.min(1,(now-start)/duration):1,ease=typeof animate==='number'?t:t*t*(3-2*t);for(const [id,to] of targets){const a=from.get(id)||to,p=interpolateScatter(a,to,ease);current.set(id,p);paint(id,p);}if(t<1)animation=requestAnimationFrame(tick);else{animation=requestAnimationFrame(()=>{animation=0;if(host.isConnected)onComplete();});}};tick(start);
 },pause(){cancelAnimationFrame(animation);animation=0;},destroy(){cancelAnimationFrame(animation);}};
}
