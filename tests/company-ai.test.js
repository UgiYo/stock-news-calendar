import test from 'node:test';
import assert from 'node:assert/strict';
import {submitCloudTask} from '../src/cloud-ai.js';
import {requestAI} from '../src/local-ai.js';
import {submitLocalTask} from '../src/local-background.js';
import {resultRecords} from '../src/ai-results.js';
const config={provider:'litellm',endpoint:'https://company.example/v1',model:'gateway-model',key:'company-gateway-key',transport:'direct'};
test('company cloud submission rejects before any capability request or key serialization',async()=>{
 const old=globalThis.fetch;let calls=0;globalThis.fetch=async()=>{calls++;throw Error('external request');};
 try{await assert.rejects(submitCloudTask({kind:'podcast',input:{text:'private transcript'},config}),/禁止送到雲端/);assert.equal(calls,0);
 await assert.rejects(submitCloudTask({kind:'podcast',input:{local_only:true,text:'private transcript'},config:{provider:'openai',endpoint:'https://api.openai.com/v1'}}),/禁止送到雲端/);assert.equal(calls,0);
 }finally{globalThis.fetch=old;}
});
test('working company direct connection still needs only gateway settings, no pairing or backend',async()=>{
 const requests=[];const answer=await requestAI(config,'company transcript',{fetcher:async(url,o)=>{requests.push(url);assert.equal(o.headers.Authorization,'Bearer company-gateway-key');assert.equal(o.redirect,'error');return {ok:true,json:async()=>({choices:[{message:{content:'company summary'}}]})};}});
 assert.equal(answer,'company summary');assert.deepEqual(requests,['https://company.example/v1/chat/completions']);
});
test('optional local background sends company data only to loopback, results stay local',async()=>{
 const requests=[],c={...config,transport:'python',bridge:'http://127.0.0.1:8765',bridgeToken:'paired'};
 const row=await submitLocalTask({kind:'podcast',title:'EP',input:{text:'private transcript'},config:c},{fetcher:async(url,o)=>{
 requests.push(url);assert.ok(url.startsWith('http://127.0.0.1:8765/'));assert.equal(o.redirect,'error');
 if(url.endsWith('/health')){assert.ok(!JSON.stringify(o).includes(c.key));return {ok:true,json:async()=>({service:'stock-news-local-ai',version:5,local_jobs:true})};}
 const body=JSON.parse(o.body);assert.equal(body.config.key,c.key);assert.equal(body.input.text,'private transcript');return {ok:true,json:async()=>({task:{id:'fixture',kind:'podcast',title:'EP',state:'running',text:'private transcript',progress:'running'}})};
 }});
 assert.equal(row.id,'fixture');assert.equal(requests.length,2);const result=resultRecords('guest',true).find(r=>r.local_id==='fixture');assert.equal(result.state,'running');assert.equal(result.cloud_id,null);assert.ok(result.local_only);
});
test('old local tool fails clearly with no fallback upload',async()=>{
 let calls=0;await assert.rejects(submitLocalTask({config:{...config,transport:'python',bridge:'http://127.0.0.1:8765',bridgeToken:'paired'}},{fetcher:async()=>{calls++;return {ok:true,json:async()=>({service:'stock-news-local-ai',version:4})};}}),/第 5 版/);assert.equal(calls,1);
});
