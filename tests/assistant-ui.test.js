import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseHTML} from 'linkedom';
import {build} from 'esbuild';
test('assistant expands, searches archived news and restores searchable history',async()=>{
 const {window}=parseHTML('<html><body></body></html>');
 Object.assign(globalThis,{document:window.document,matchMedia:()=>({matches:false})});window.HTMLElement.prototype.focus=function(){};
 const storage=new Map();globalThis.localStorage={getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)};
 const longThread={id:'long',title:'長對話',updatedAt:'2026-10-01T00:00:00Z',stocks:[],turns:Array.from({length:40},(_,i)=>({question:'歷史問題 '+i,answer:'歷史回答 '+i,sources:[]}))};localStorage.setItem('stock-site-assistant-threads-v1:alice',JSON.stringify([longThread]));
 const calls=[];let prompt='';globalThis.assistantFixture={request:async path=>{calls.push(path);return {news:[{company_code:'2330',title:'台積電擴廠消息',news_date:'2025-02-01',url:'https://example.com/old'}]};},answer:async text=>{prompt=text;return '較早的擴廠消息 [S1]';}};
 const stubs={
  'local-ai.js':"export const currentAISettings=()=>({});export const requestAI=(_config,text)=>globalThis.assistantFixture.answer(text);export const openAIWindow=()=>{};export const openAINews=()=>{};",
  'api.js':"export const remoteAPI=(path)=>globalThis.assistantFixture.request(path);export const api=remoteAPI;",
  'ai-auth.js':"export const requireAISession=async()=>{};",
  'account-sync.js':"export const deviceData=()=>null;",
  'markdown-preview.js':"export const showMarkdown=(node,text)=>{node.textContent=text;};",
  'podcasts.js':"export const openPodcastEpisode=()=>{};"
 };
 const compiled=await build({entryPoints:['src/site-assistant.js'],bundle:true,platform:'node',format:'esm',write:false,loader:{'.css':'empty'},plugins:[{name:'fixtures',setup(b){b.onResolve({filter:/./},args=>{const name=args.path.split('/').at(-1);if(stubs[name])return {path:name,namespace:'fixture'};});b.onLoad({filter:/./,namespace:'fixture'},args=>({contents:stubs[args.path],loader:'js'}));}}]});
 const {installSiteAssistant}=await import('data:text/javascript;base64,'+Buffer.from(compiled.outputFiles[0].text).toString('base64'));
 let owner='alice';installSiteAssistant(()=>({userId:owner,news:[],companies:[{code:'2330',name:'台積電'}],records:[],episodes:[]}));
 const el=s=>document.querySelector(s);el('#site-assistant-launch').click();assert.equal(el('#site-assistant-panel').hidden,false);
 el('[data-expand]').click();assert.ok(el('#site-assistant-panel').classList.contains('site-assistant-expanded'));assert.equal(el('[data-expand]').getAttribute('aria-pressed'),'true');el('[data-expand]').click();assert.equal(el('[data-expand]').getAttribute('aria-pressed'),'false');
 el('textarea').value='台積電擴廠消息';await el('form').onsubmit({preventDefault(){}});assert.ok(calls[0].includes('from=0001-01-01'));assert.match(prompt,/2025-02-01/);assert.ok(el('[data-history]').textContent.includes('較早的擴廠消息'));
 el('[data-new-chat]').click();assert.equal(el('[data-chat-title]').textContent,'開始新對話');assert.equal(el('[data-history]').children.length,0);
 el('[data-threads]').click();assert.equal(el('.site-assistant-threads').hidden,false);assert.equal(el('[data-threads]').getAttribute('aria-expanded'),'true');
 el('#assistant-thread-search').value='找不到';el('#assistant-thread-search').oninput();assert.equal(document.querySelectorAll('[data-thread]').length,0);
 el('#assistant-thread-search').value='擴廠';el('#assistant-thread-search').oninput();assert.equal(document.querySelectorAll('[data-thread]').length,1);await el('[data-thread]').onclick();assert.ok(el('[data-history]').textContent.includes('較早的擴廠消息'));assert.equal(el('[data-thread]').getAttribute('aria-pressed'),'true');
 el('#assistant-thread-search').value='';el('#assistant-thread-search').oninput();
 await el('[data-thread="long"]').onclick();assert.equal(document.querySelectorAll('.site-chat-message').length,16);assert.ok(el('[data-history]').textContent.includes('歷史問題 39'));assert.ok(!el('[data-history]').textContent.includes('歷史問題 0'));assert.match(el('[data-earlier]').textContent,/32/);
 await el('[data-earlier]').onclick();assert.equal(document.querySelectorAll('.site-chat-message').length,32);
 const oldLoad=el('[data-thread="long"]').onclick();el('[data-new-chat]').click();await oldLoad;assert.equal(el('[data-history]').children.length,0);assert.equal(el('[data-status]').textContent,'新對話已開始。');
 const deferred=[];globalThis.assistantFixture.answer=()=>new Promise(resolve=>deferred.push(resolve));
 const wait=async check=>{for(let i=0;i<100;i++){if(check())return;await new Promise(resolve=>setTimeout(resolve,1));}throw Error('fixture timed out');};
 el('textarea').value='台積電舊請求';const oldRequest=el('form').onsubmit({preventDefault(){}});await wait(()=>deferred.length===1);
 el('[data-new-chat]').click();assert.equal(el('[type=submit]').disabled,false);el('[data-threads]').click();assert.ok(!el('[data-thread]').disabled);
 el('textarea').value='台積電新請求';const newRequest=el('form').onsubmit({preventDefault(){}});await wait(()=>deferred.length===2);deferred[0]('舊回答不應顯示');await oldRequest;assert.equal(el('[type=submit]').disabled,true);assert.ok(!el('[data-history]').textContent.includes('舊回答不應顯示'));
 deferred[1]('新回答');await newRequest;assert.ok(el('[data-history]').textContent.includes('新回答'));assert.equal(el('[type=submit]').disabled,false);
 el('textarea').value='台積電切換中';const switchedRequest=el('form').onsubmit({preventDefault(){}});await wait(()=>deferred.length===3);await el('[data-thread="long"]').onclick();deferred[2]('切換前舊回答');await switchedRequest;assert.equal(el('[data-chat-title]').textContent,'長對話');assert.ok(!el('[data-history]').textContent.includes('切換前舊回答'));assert.equal(el('[type=submit]').disabled,false);
 el('[data-close]').click();owner='bob';el('#site-assistant-launch').click();assert.equal(document.querySelectorAll('[data-thread]').length,0);assert.equal(el('[data-history]').children.length,0);
});
