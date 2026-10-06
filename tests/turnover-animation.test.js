import test from 'node:test';
import assert from 'node:assert/strict';
import {turnoverFrames} from '../src/turnover-animation.js';
const catalog={groups:[{id:'a',industry:'半導體',name:'設計',codes:['1111']},{id:'b',industry:'PCB',name:'基板',codes:['2222']}]};
const history=Array.from({length:15},(_,i)=>({date:'2026-09-'+String(i+1).padStart(2,'0'),previousDate:i?'2026-09-'+String(i).padStart(2,'0'):null,turnover:[['1111',10+i],['2222',90-i]],total:100}));
test('animation uses latest ten saved trading dates at or before selected date',()=>{const r=turnoverFrames(catalog,history,'2026-09-13');assert.equal(r.frames.length,10);assert.equal(r.frames[0].date,'2026-09-04');assert.equal(r.frames.at(-1).date,'2026-09-13');assert.equal(r.frames[0].flows.find(g=>g.id==='a').change,1);});
test('industry scope limits segments without changing market denominator',()=>{const r=turnoverFrames(catalog,history,'2026-09-15','半導體');assert.equal(r.groups.length,1);assert.equal(r.frames.at(-1).flows[0].share,24);});
test('missing prior date leaves change unknown and missing history creates no points',()=>{const r=turnoverFrames(catalog,[history[2]],'2026-09-15');assert.equal(r.frames[0].flows[0].change,null);assert.equal(turnoverFrames(catalog,[],'2026-09-15').frames.length,0);});
test('mobile cards expose full names, money, direction and daily rank without a wide SVG',async()=>{
 const {flowCards}=await import('../src/turnover-animation.js');const frame={date:'2026-09-02',previousDate:'2026-09-01',flows:[{id:'a',industry:'半導體',name:'中游／生產製程及檢測設備',amount:2e8,share:10,change:2},{id:'b',industry:'PCB',name:'基板<script>',amount:1e8,share:5,change:-1}]},previous={date:'2026-09-01',flows:[{id:'a',amount:1},{id:'b',amount:2}]};const html=flowCards(frame,previous,2e8);assert.ok(html.includes('中游／生產製程及檢測設備'));assert.ok(html.includes('2.0'));assert.ok(html.includes('熱度 ↑'));assert.ok(html.includes('排名 ↑1'));assert.ok(html.includes('基板&lt;script&gt;'));assert.ok(!html.includes('<svg'));assert.ok(!html.includes('min-width:740'));
});
test('ten-day trend identifies sustained warming and separates stock directions',async()=>{
 const {tenDayTrends}=await import('../src/turnover-animation.js');const c={groups:[{id:'g',industry:'半導體',name:'設計',codes:['1111','2222']}]};const h=Array.from({length:10},(_,i)=>({date:'2026-09-'+String(i+1).padStart(2,'0'),previousDate:i?'2026-09-'+String(i).padStart(2,'0'):null,total:100,turnover:[['1111',5+i*2],['2222',15-i],['9999',80-i]]}));const r=tenDayTrends(turnoverFrames(c,h,'2026-09-10'))[0];assert.equal(r.label,'持續升溫');assert.equal(r.ups,9);assert.ok(r.members.find(x=>x.code==='1111').delta>0);assert.ok(r.members.find(x=>x.code==='2222').delta<0);assert.equal(r.before,21);assert.equal(r.after,28);
});
test('trend does not label insufficient or incomplete classification data',async()=>{const {tenDayTrends}=await import('../src/turnover-animation.js');assert.deepEqual(tenDayTrends(turnoverFrames(catalog,history.slice(0,5),'2026-09-15')),[]);const model=turnoverFrames(catalog,history.slice(0,10),'2026-09-15');model.frames[0].flows=[];assert.deepEqual(tenDayTrends(model),[]);});

test('industry trend combines overlapping segments without double counting',async()=>{const {industryCatalog}=await import('../src/value-chains.js');const {tenDayTrends,leaderPanel}=await import('../src/turnover-animation.js');const groups=industryCatalog({groups:[{industry:'半導體',codes:['1111']},{industry:'半導體',codes:['1111','2222']}]});const model=turnoverFrames(groups,history,'2026-09-15');assert.equal(model.frames.at(-1).flows[0].share,100);assert.equal(tenDayTrends(model)[0].delta,0);assert.match(leaderPanel({leaders:[]}),/暫不推定/);});
test('trend choices include the actual share series and comparison, escaping labels',async()=>{
 const {trendChoice,trendSpark}=await import('../src/turnover-animation.js');
 const t={series:[2,4,3],before:2,after:3,delta:1,label:'近期轉強'};
 const html=trendChoice('group:a','濾波器<script>',t,true);
 assert.ok(html.includes('8,35 80,7 152,21'));
 assert.ok(html.includes('2.00% → 3.00%（+1.00 個百分點）'));
 assert.ok(html.includes('aria-pressed="true"'));
 assert.ok(html.includes('成交占比 4.00%'));
 assert.ok(trendSpark({...t,dates:['2026-10-01','2026-10-02','2026-10-05']}).includes('2026-10-02：成交占比 4.00%'));
 assert.ok(html.includes('濾波器&lt;script&gt;'));
 assert.ok(!html.includes('<script>'));
 assert.ok(trendSpark({series:[3,3,3],delta:0}).includes('8,35 80,35 152,35'));
 assert.ok(!trendSpark(null).includes('<svg'));
});
test('trend dropdown sorts strongest increases first, cooling later, missing last',async()=>{
 const {sortTrendChoices}=await import('../src/turnover-animation.js');
 const choices=[{title:'missing'},{title:'cool',trend:{delta:-5}},{title:'warm',trend:{delta:2}},{title:'flat',trend:{delta:0}},{title:'hottest',trend:{delta:6}}];
 assert.deepEqual(sortTrendChoices(choices).map(c=>c.title),['hottest','warm','flat','cool','missing']);
 assert.equal(choices[0].title,'missing');
});
