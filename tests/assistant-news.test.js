import test from 'node:test';
import assert from 'node:assert/strict';
import {loadAssistantNews} from '../src/assistant-news.js';
test('assistant queries all months and paginates using server count after device merge',async()=>{
 const page=Array.from({length:500},(_,i)=>({company_code:'2327',url:'https://example/'+i,news_date:'2026-10-01'}));
 const old={company_code:'2327',url:'https://example/old',news_date:'2025-01-01'};
 const calls=[];
 const rows=await loadAssistantNews(async path=>{calls.push(path);return calls.length===1?{news:[...page,old],serverCount:500}:{news:[old],serverCount:1};});
 assert.equal(rows.length,501);assert.equal(rows.find(n=>n.url===old.url).news_date,'2025-01-01');
 assert.deepEqual(calls,['/news?from=0001-01-01&to=9999-12-31&offset=0','/news?from=0001-01-01&to=9999-12-31&offset=500']);
});
test('archive failure propagates instead of answering from a partial month',async()=>{
 await assert.rejects(loadAssistantNews(async()=>{throw Error('暫時無法讀取');},{news:[{company_code:'2327',url:'saved'}]}),/暫時無法讀取/);
});
test('archive stops on cancellation and account changes',async()=>{
 const controller=new AbortController();controller.abort();let calls=0;
 await assert.rejects(loadAssistantNews(async()=>{calls++;},{signal:controller.signal}));assert.equal(calls,0);
 let current=true;await assert.rejects(loadAssistantNews(async()=>{current=false;return {news:[]};},{isCurrent:()=>current}),/登入帳號已變更/);
});
