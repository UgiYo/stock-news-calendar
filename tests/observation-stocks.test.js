import test from 'node:test';
import assert from 'node:assert/strict';
import {selectObservationStocks} from '../src/observation-stocks.js';
const member=(code,delta=0.2)=>({code,complete:true,before:1,after:1+delta,delta,amount:2e8});
const group=(id,industry,code)=>({id,industry,name:'細項',label:'持續升溫',series:Array(10).fill(1),comparisons:9,delta:1,members:[member(code),member(code+'a'),member(code+'b')]});
const groups=[group('a','半導體','1111'),group('b','航運','2222'),group('c','PCB','3333'),group('d','金融','4444')],stocks=['1111','2222','3333','4444'].map(code=>({code,name:code}));
test('observation shortlist prioritizes qualifying tracked stocks and caps at three distinct industries',()=>{
 const r=selectObservationStocks(groups,stocks,[{code:'4444'}]);assert.equal(r.length,3);assert.equal(r[0].code,'4444');assert.equal(new Set(r.map(s=>s.industry)).size,3);assert.equal(r[0].peerCount,2);assert.equal(r[0].peerDelta,0.8);
});
test('observation list rejects single-stock spikes, weak own trend and incomplete history',()=>{
 for(const changed of [{series:Array(9).fill(1)},{comparisons:4},{label:'持續降溫'},{delta:0.3},{members:[member('1111'),member('peer')]},{members:[{...member('1111'),complete:false},member('a'),member('b')]},{members:[member('1111',0.01),member('a'),member('b')]},{members:[{...member('1111'),amount:1e7},member('a'),member('b')]}])assert.deepEqual(selectObservationStocks([{...groups[0],...changed}],stocks),[]);
});
test('overlapping classifications deduplicate stocks, prefer peer-supported group and do not fill missing slots',()=>{
 const alternative={...groups[0],id:'other',delta:2};const r=selectObservationStocks([groups[0],alternative,{...groups[1],industry:'半導體'}],stocks);assert.equal(r.length,1);assert.equal(r[0].groupId,'other');assert.deepEqual(selectObservationStocks([],stocks),[]);
});
