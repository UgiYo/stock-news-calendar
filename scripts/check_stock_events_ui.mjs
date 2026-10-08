import {parseHTML} from 'linkedom';
import {build} from 'esbuild';
import assert from 'node:assert/strict';
const {window}=parseHTML('<html><body></body></html>');
Object.assign(globalThis,{window,document:window.document,DOMParser:window.DOMParser,CustomEvent:window.CustomEvent,location:{hostname:'localhost'},Node:window.Node});window.HTMLElement.prototype.focus=function(){};window.HTMLElement.prototype.scrollIntoView=function(){};
const storage=new Map();globalThis.localStorage={get length(){return storage.size},key:i=>[...storage.keys()][i],getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,String(v)),removeItem:k=>storage.delete(k)};
localStorage.setItem('stock-news-session','alice');localStorage.setItem('stock-news-local-ai-v1',JSON.stringify({provider:'openai',endpoint:'https://api.openai.com/v1',key:'fixture',model:'gpt-test',transport:'direct'}));
const caches=new Map();let aiCalls=0;
const news=[{company_code:'2330',news_date:'2026-09-04',published_at:'2026-09-04T01:00:00Z',title:'台積電訂單確認',source:'中央社',url:'https://www.cna.com.tw/story'}];
const movement={code:'2330',date:'2026-10-07',from:'2026-10-01',triggered:true,windows:[{days:3,change:9.2,from:'2026-10-05',to:'2026-10-07',triggered:true,excess:7,volumeRatio:1.6}],priceWarning:'未還原股價'};
globalThis.fetch=async(url,options={})=>{const who=localStorage.getItem('stock-news-session'),u=new URL(url);if(u.hostname==='api.openai.com'){aiCalls++;return Response.json({choices:[{message:{content:'可能事件為訂單確認，證據中等；缺新進展，無法確認主要原因。[1]'}}]});}
 if(u.pathname==='/me')return Response.json({user:{id:who}});
 if(u.pathname==='/stock-event-news')return Response.json({owner_id:who,company:{code:'2330',name:'台積電'},movement,news,coverage:{from:'2026-08-17',to:'2026-10-07',failures:[],failedSegments:0,note:'搜尋不保證完整收錄'}});
 if(u.pathname==='/article-content')return Response.json({url:news[0].url,text:'台積電訂單與營運資料，不確認股價因果。'.repeat(12)});
 if(u.pathname==='/stock-event-cache'){const b=JSON.parse(options.body),key=who+':'+b.key;if(b.action==='claim')return Response.json({owner_id:who,...(caches.has(key)?{answer:caches.get(key)}:{lease:'fixture'})});if(b.action==='save')caches.set(key,b.answer);return Response.json({ok:true,owner_id:who});}
 return Response.json({owner_id:who,results:[],deleted:[],count:0});
};
const compiled=await build({stdin:{contents:"export {openStockEvent,closeStockEventOnOwnerChange} from './src/stock-events.js'; export {setResultOwner,resultRecords} from './src/ai-results.js';",resolveDir:process.cwd()},bundle:true,platform:'node',format:'esm',write:false,define:{'import.meta.env':JSON.stringify({VITE_WORKER_API_URL:'https://api.test',BASE_URL:'/'})}});
const mod=await import('data:text/javascript;base64,'+Buffer.from(compiled.outputFiles[0].text).toString('base64'));
const wait=async pred=>{for(let i=0;i<1000;i++){if(pred())return;await new Promise(r=>setTimeout(r,5));}throw Error(document.body.textContent);};
try{
 mod.setResultOwner('alice');mod.openStockEvent({code:'2330',owner:'alice',date:'2026-10-07'});await wait(()=>document.querySelector('[data-event-generate]')&&!document.querySelector('[data-event-generate]').disabled);
 document.querySelector('[data-event-generate]').click();await wait(()=>document.querySelector('[data-event-answer]')?.textContent.includes('可能事件為訂單確認'));assert.equal(aiCalls,1);assert.ok(document.body.textContent.includes('來源索引'));assert.ok(mod.resultRecords('alice').some(r=>r.id.startsWith('stock-event:')));
 document.querySelector('[data-event-generate]').click();await wait(()=>document.querySelector('[data-event-status]').textContent.includes('已保存結果'));assert.equal(aiCalls,1);
 mod.closeStockEventOnOwnerChange('device-switch');storage.clear();localStorage.setItem('stock-news-session','alice');localStorage.setItem('stock-news-local-ai-v1',JSON.stringify({provider:'openai',endpoint:'https://api.openai.com/v1',key:'fixture',model:'gpt-test',transport:'direct'}));
 const secondDevice=await import('data:text/javascript;base64,'+Buffer.from(compiled.outputFiles[0].text).toString('base64')+'#second-device');secondDevice.setResultOwner('alice');secondDevice.openStockEvent({code:'2330',owner:'alice',date:'2026-10-07'});await wait(()=>document.querySelector('[data-event-generate]')&&!document.querySelector('[data-event-generate]').disabled);document.querySelector('[data-event-generate]').click();await wait(()=>document.querySelector('[data-event-answer]')?.textContent.includes('可能事件為訂單確認'));assert.equal(aiCalls,1);secondDevice.closeStockEventOnOwnerChange('bob');
 mod.closeStockEventOnOwnerChange('bob');mod.setResultOwner('bob');localStorage.setItem('stock-news-session','bob');assert.equal(document.querySelector('#stock-event-dialog'),null);assert.equal(mod.resultRecords('bob').length,0);
 mod.openStockEvent({code:'2330',owner:'bob',date:'2026-10-07'});await wait(()=>document.querySelector('[data-event-generate]')&&!document.querySelector('[data-event-generate]').disabled);document.querySelector('[data-event-generate]').click();await wait(()=>document.querySelector('[data-event-answer]')?.textContent.includes('可能事件為訂單確認'));assert.equal(aiCalls,2);
 console.log(JSON.stringify({dialogRendering:true,analysis:true,personalCache:true,sameAccountAcrossDevices:true,accountIsolation:true,closesOnAccountChange:true,aiCalls}));process.exit(0);
}catch(e){console.error(e);process.exit(1);}
