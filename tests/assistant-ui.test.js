import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseHTML} from 'linkedom';
import {build} from 'esbuild';
test('assistant expands, searches archived news and restores searchable history',async()=>{
 const {window}=parseHTML('<html><body></body></html>');
 Object.assign(globalThis,{document:window.document,matchMedia:()=>({matches:false})});window.HTMLElement.prototype.focus=function(){};
 const storage=new Map();globalThis.localStorage={getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)};
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
 el('#assistant-thread-search').value='擴廠';el('#assistant-thread-search').oninput();assert.equal(document.querySelectorAll('[data-thread]').length,1);el('[data-thread]').click();assert.ok(el('[data-history]').textContent.includes('較早的擴廠消息'));assert.equal(el('[data-thread]').getAttribute('aria-pressed'),'true');
 el('[data-close]').click();owner='bob';el('#site-assistant-launch').click();assert.equal(document.querySelectorAll('[data-thread]').length,0);assert.equal(el('[data-history]').children.length,0);
});
