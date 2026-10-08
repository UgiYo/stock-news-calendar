import {test} from 'node:test';
import assert from 'node:assert/strict';
import {loadAssistantNews} from '../src/assistant-news.js';
import {assistantSources,assistantDateRange} from '../src/assistant-sources.js';
test('archive loads every page and merges device news without the calendar month',async()=>{
 const calls=[],page=Array.from({length:500},(_,i)=>({id:i,url:'https://example.com/'+i,company_code:'2330',news_date:'2025-01-01'}));
 const news=await loadAssistantNews({request:async path=>{calls.push(path);return {news:calls.length===1?page:[{...page[0],article_summary:'saved summary'},{id:501,url:'https://example.com/501',company_code:'2330',news_date:'2024-05-01'}]};},news:[{...page[1],article_summary:'device summary'}]});
 assert.equal(calls.length,2);assert.match(calls[0],/from=0001-01-01&to=9999-12-31&offset=0/);assert.match(calls[1],/offset=500/);assert.equal(news.length,501);assert.equal(news.find(n=>n.id===1).article_summary,'device summary');assert.ok(news.some(n=>n.news_date==='2024-05-01'));
});
test('failed archive page is visible rather than silently returning partial news',async()=>{
 await assert.rejects(loadAssistantNews({request:async()=>{throw Error('quota');}}),/quota/);
});
test('account change or cancellation stops retrieval',async()=>{
 await assert.rejects(loadAssistantNews({request:async()=>({news:[]}),assertOwner:()=>{throw Error('owner changed');}}),/owner changed/);
 const controller=new AbortController();controller.abort();let calls=0;await assert.rejects(loadAssistantNews({signal:controller.signal,request:async()=>{calls++;return {news:[]};}}));assert.equal(calls,0);
});
test('relevant older news is not crowded out by twelve newer headlines',()=>{
 const companies=[{code:'2330',name:'台積電'}],news=Array.from({length:20},(_,i)=>({company_code:'2330',title:'台積電日常消息',news_date:'2026-10-07',url:'https://example.com/'+i}));news.push({company_code:'2330',title:'台積電擴廠規劃',news_date:'2025-01-01',url:'https://example.com/old'});
 assert.equal(assistantSources('台積電過去有哪些擴廠消息？',{companies,news})[0].title,'台積電擴廠規劃');
});
test('explicit date periods filter archive; stock code alone does not',()=>{
 assert.equal(assistantDateRange('2026股票新聞'),null);assert.deepEqual(assistantDateRange('2025年2月'),{from:'2025-02-01',to:'2025-02-28'});assert.deepEqual(assistantDateRange('2025-12-01 到 2026-01-03'),{from:'2025-12-01',to:'2026-01-03'});
 const companies=[{code:'2330',name:'台積電'}],news=[{company_code:'2330',title:'台積電消息',news_date:'2025-02-01'},{company_code:'2330',title:'台積電近期消息',news_date:'2026-10-07'}];assert.equal(assistantSources('台積電2025年2月新聞',{companies,news}).length,1);
});
