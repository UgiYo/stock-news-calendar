import test from 'node:test';
import assert from 'node:assert/strict';
import {observationTechnical} from '../src/observation-technicals.js';
const prices=Array.from({length:70},(_,i)=>({date:new Date(Date.UTC(2026,0,1+i)).toISOString().slice(0,10),close:100+i*.1}));
const date=prices.at(-1).date;
test('rising orderly prices pass with correctly computed averages and biases',()=>{
 const r=observationTechnical(prices,date);assert.equal(r.eligible,true);assert.ok(r.ma[5]>r.ma[10]&&r.ma[10]>r.ma[20]&&r.ma[20]>r.ma[60]);
 assert.ok(Math.abs(r.ma[5]-106.7)<1e-9);assert.ok(Math.abs(r.bias5-(106.9/106.7-1)*100)<1e-9);
});
test('overextension and closes below MA5 are excluded despite bullish averages',()=>{
 const spike=observationTechnical([...prices.slice(0,-1),{date,close:130}],date);assert.equal(spike.bull,true);assert.equal(spike.eligible,false);assert.match(spike.reason,/乖離過大/);
 const pullback=observationTechnical([...prices.slice(0,-1),{date,close:106}],date);assert.equal(pullback.bull,true);assert.equal(pullback.eligible,false);assert.match(pullback.reason,/低於 MA5/);
});
test('flat, falling, insufficient, stale and invalid price histories fail closed',()=>{
 for(const rows of [prices.map(p=>({...p,close:100})),prices.map((p,i)=>({...p,close:200-i})),prices.slice(-60),prices.slice(0,-1),prices.map((p,i)=>i===65?{...p,close:null}:p)])assert.equal(observationTechnical(rows,date).eligible,false);
});
test('historical screening excludes future prices and deduplicates and orders dates',()=>{
 const historical=prices.at(-5).date,expected=observationTechnical(prices.slice(0,-4),historical);
 assert.deepEqual(observationTechnical([...prices].reverse(),historical),expected);
 assert.deepEqual(observationTechnical([...prices,prices[0]],historical),expected);
});
