import test from 'node:test';
import assert from 'node:assert/strict';
import {selectObservationStocks} from '../src/observation-stocks.js';
const member=(code,delta=0.2)=>({code,complete:true,before:1,after:1+delta,delta,amount:2e8});
const group=(id,industry,code)=>({id,industry,name:'細項',label:'持續升溫',series:Array(10).fill(1),comparisons:9,delta:1,members:[member(code),member(code+'a'),member(code+'b')]});
const technicals=Object.fromEntries(['1111','2222','3333','4444'].map(code=>[code,{eligible:true,bias5:1}]));
const groups=[group('a','半導體','1111'),group('b','航運','2222'),group('c','PCB','3333'),group('d','金融','4444')],stocks=['1111','2222','3333','4444'].map(code=>({code,name:code}));
test('observation shortlist prioritizes qualifying tracked stocks and caps at three distinct industries',()=>{
 const r=selectObservationStocks(groups,stocks,[{code:'4444'}],technicals);assert.equal(r.length,3);assert.equal(r[0].code,'4444');assert.equal(new Set(r.map(s=>s.industry)).size,3);assert.equal(r[0].peerCount,2);assert.equal(r[0].peerDelta,0.8);
});
test('observation list rejects single-stock spikes, weak own trend and incomplete history',()=>{
 for(const changed of [{series:Array(9).fill(1)},{comparisons:4},{label:'持續降溫'},{delta:0.3},{members:[member('1111'),member('peer')]},{members:[{...member('1111'),complete:false},member('a'),member('b')]},{members:[member('1111',0.01),member('a'),member('b')]},{members:[{...member('1111'),amount:1e7},member('a'),member('b')]}])assert.deepEqual(selectObservationStocks([{...groups[0],...changed}],stocks,[],technicals),[]);
});
test('overlapping classifications deduplicate stocks, prefer peer-supported group and do not fill missing slots',()=>{
 const alternative={...groups[0],id:'other',delta:2};const r=selectObservationStocks([groups[0],alternative,{...groups[1],industry:'半導體'}],stocks,[],technicals);assert.equal(r.length,1);assert.equal(r[0].groupId,'other');assert.deepEqual(selectObservationStocks([],stocks,[],technicals),[]);
});

test('technical remarks never exclude or reorder turnover picks, including unavailable data',()=>{
 const expected=['1111','2222','3333'];
 assert.deepEqual(selectObservationStocks(groups,stocks).map(r=>r.code),expected);
 const result=selectObservationStocks(groups,stocks,[],{...technicals,'1111':{eligible:false,reason:'乖離過大'}});
 assert.deepEqual(result.map(r=>r.code),expected);
 assert.equal(result[0].technical.reason,'乖離過大');
 assert.deepEqual(selectObservationStocks(groups,stocks,[{code:'4444'}],{'4444':{eligible:false,reason:'行情讀取失敗'}}).map(r=>r.code),['4444','1111','2222']);
});
test('technical notes describe bearish and missing data without claiming bullish alignment',async()=>{
 const {observationTechnicalNote}=await import('../src/turnover-animation.js');
 assert.match(observationTechnicalNote(undefined,true),/載入中/);
 assert.match(observationTechnicalNote({reason:'缺少收盤價'}),/缺少收盤價/);
 const html=observationTechnicalNote({close:10,ma:{5:11,10:12,20:13,60:14},bull:false,rising:false,bias5:-9,bias20:-23,reason:'收盤價低於 MA5'});
 assert.match(html,/尚未多頭排列/);assert.match(html,/未皆上揚/);assert.match(html,/-9.00%/);assert.match(html,/不影響入選/);
});
