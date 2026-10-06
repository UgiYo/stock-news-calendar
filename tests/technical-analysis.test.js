import test from 'node:test';
import assert from 'node:assert/strict';
import {technicalAnalysis,technicalPrompt,technicalPanel} from '../src/technical-analysis.js';
const rows=Array.from({length:65},(_,i)=>({date:new Date(Date.UTC(2026,0,1+i)).toISOString().slice(0,10),open:100+i,high:102+i,low:99+i,close:101+i,volume:i===64?3000:1000}));
test('daily analysis computes price returns moving averages and volume ratio excluding latest bar',()=>{
 const t=technicalAnalysis(rows);assert.equal(t.close,165);assert.equal(t.ma[5],163);assert.equal(t.slopes[20],1);assert.equal(t.volumeAverage,1000);assert.equal(t.volumeRatio,3);assert.equal(t.bull,true);assert.ok(Math.abs(t.returns[5]-(165/160-1)*100)<1e-9);assert.deepEqual(t.range,{high:166,low:144});
});
test('missing volume and short histories remain unknown rather than zero or bullish',()=>{
 const t=technicalAnalysis(rows.slice(0,5));assert.equal(t.ma[20],null);assert.equal(t.bull,null);assert.equal(t.volumeRatio,null);assert.equal(t.returns[5],null);
 assert.equal(technicalAnalysis(rows.map((r,i)=>i===60?{...r,volume:null}:r)).volumeAverage,null);assert.equal(technicalAnalysis([]),null);
});
test('ordering deduplication invalid prices and intraday bars are handled',()=>{
 const t=technicalAnalysis([...rows].reverse().concat(rows[0],{...rows[0],date:'bad'},{...rows[0],date:'2027-01-01',close:-1}));assert.equal(t.sessions,65);assert.equal(t.close,165);
});
test('AI context includes actual price volume data and visible source date without requiring financial profile',()=>{
 const detail={code:'2330',prices:rows,priceSource:'TWSE'};const prompt=technicalPrompt(detail);assert.match(prompt,/TWSE/);assert.match(prompt,/"volumeRatio":3/);assert.match(prompt,/不補造/);assert.match(technicalPanel(detail,s=>s),/AI 技術分析/);assert.match(technicalPanel({},s=>s),/disabled/);assert.equal(technicalPrompt({}),null);
});
