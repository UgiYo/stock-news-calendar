import test from 'node:test';import assert from 'node:assert/strict';import {topTurnover,filterSector} from '../src/ranking.js';
test('turnover ranks by amount not shares and returns only ten',()=>{const rows=Array.from({length:15},(_,i)=>({code:String(1000+i),amount:i*100,tag:i%2?'半導體':'航運'}));assert.equal(topTurnover(rows).length,10);assert.equal(topTurnover(rows)[0].code,'1014');assert.equal(rows[0].code,'1000');});
test('sector selection includes matching stocks outside top ten',()=>{const rows=Array.from({length:15},(_,i)=>({code:String(1000+i),amount:i,tag:'半導體'}));assert.equal(filterSector(rows,'半導體').length,15);assert.equal(filterSector(rows,'航運').length,0);assert.equal(filterSector(rows,'').length,15);});
test('distribution selection updates its own table and lists constituents even outside the top twenty',async()=>{
 const {chainPanel}=await import('../src/ranking.js');
 const stocks=Array.from({length:25},(_,i)=>({code:String(1000+i),name:'公司'+i,amount:25-i,tag:'產業'}));
 const catalog={updated_at:'2026-10-05',groups:stocks.map((r,i)=>({id:'g'+i,industry:'產業',name:'細項'+i,codes:[r.code]}))};
 const html=chainPanel({stocks,previousStocks:stocks,history:[]},catalog,[],'2026-10-05',s=>s,'','chain:g24');
 assert.match(html,/<option value="chain:g24" selected>/);
 assert.match(html,/下方已切換為這個細項/);
 assert.match(html,/data-stock="1024"/);
 assert.match(html,/100\.0%/);
 assert.doesNotMatch(html,/data-chain-choice="chain:g0"/);
 assert.match(chainPanel({stocks},catalog,[],'2026-10-05',s=>s,''),/data-chain-choice="chain:g0"/);
});
