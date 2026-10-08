import test from 'node:test';
import assert from 'node:assert/strict';
import {parseHTML} from 'linkedom';
import {updateRankingDateStatus,updateRankingReturns} from '../src/ranking.js';
import {updateObservationTechnicals,turnoverFrames} from '../src/turnover-animation.js';
test('date feedback names pending and displayed dates and supports completion and retry',()=>{
 const {document}=parseHTML('<section><p data-ranking-date-status></p><p data-ranking-date-status></p><button data-observation-retry></button><article id="card"></article></section>');
 const host=document.querySelector('section'),card=host.querySelector('#card');
 updateRankingDateStatus(host,{date:'2026-10-05',pendingDate:'2026-10-06'});
 assert.equal(host.getAttribute('aria-busy'),'true');
 for(const status of host.querySelectorAll('[data-ranking-date-status]'))assert.match(status.textContent,/正在切換至 2026-10-06.*仍顯示 2026-10-05/);
 updateRankingDateStatus(host,{date:'2026-10-06'});
 assert.match(host.textContent,/已顯示 2026-10-06/);assert.equal(host.getAttribute('aria-busy'),'false');
 updateRankingDateStatus(host,{date:'2026-10-06',error:'網路錯誤'});
 assert.match(host.textContent,/切換失敗.*仍顯示 2026-10-06.*重試/);assert.strictEqual(host.querySelector('#card'),card);
});
test('background prices update cells and notes without replacing the calendar or selected cards',()=>{
 const {document}=parseHTML('<section><details id="calendar" open></details><article><ul data-observation-technical="2330"></ul></article><p data-observation-status></p><button data-observation-retry disabled></button><table><tr><td data-return-code="2330" data-return-days="5"></td></tr></table></section>');
 const host=document.querySelector('section'),calendar=host.querySelector('#calendar'),card=host.querySelector('article');
 updateObservationTechnicals(host,{date:'2026-10-06',observationLoading:false,observationTechnicals:{2330:{reason:'缺所選日行情'}}});
 updateRankingReturns(host,{priceReturns:{}});
 assert.match(host.querySelector('[data-observation-technical]').textContent,/缺所選日行情/);
 assert.match(host.querySelector('[data-observation-status]').textContent,/已完成 2026-10-06/);
 assert.strictEqual(host.querySelector('article'),card);assert.strictEqual(host.querySelector('#calendar'),calendar);assert.ok(calendar.hasAttribute('open'));
});
test('overlapping dates reuse daily flows while checking the actual previous day',()=>{
 const catalog={groups:[{id:'a',industry:'半導體',codes:['2330']}]};
 const history=Array.from({length:12},(_,i)=>({date:`2026-09-${String(i+1).padStart(2,'0')}`,previousDate:i?`2026-09-${String(i).padStart(2,'0')}`:null,turnover:[['2330',100+i]]}));
 const first=turnoverFrames(catalog,history,'2026-09-11'),second=turnoverFrames(catalog,history,'2026-09-12');
 assert.strictEqual(first.frames.at(-1).flows[0],second.frames.at(-2).flows[0]);
 const missingPrior=turnoverFrames(catalog,[history[10]],'2026-09-11');assert.equal(missingPrior.frames[0].flows[0].change,null);
});
