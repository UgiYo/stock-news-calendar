import test from 'node:test';
import assert from 'node:assert/strict';
import {aiRequest,requestAI,saveAISettings,readAISettings} from '../src/local-ai.js';
const config={provider:'litellm',endpoint:'https://ai.example.internal/v1',model:'company-model',key:'private-token'};
test('personal key is only in direct provider auth header, never URL or prompt; redirects and cookies blocked',async()=>{
 let calls=0;
 const answer=await requestAI(config,'新聞內容',{fetcher:async(url,options)=>{calls++;assert.equal(url,'https://ai.example.internal/v1/chat/completions');assert.equal(options.headers.Authorization,'Bearer private-token');assert.equal(options.credentials,'omit');assert.equal(options.redirect,'error');assert.equal(options.referrerPolicy,'no-referrer');assert.ok(!url.includes(config.key));assert.ok(!options.body.includes(config.key));return {ok:true,json:async()=>({choices:[{message:{content:'摘要'}}]})};}});
 assert.equal(answer,'摘要');assert.equal(calls,1);
});
test('Azure uses encoded deployment and api-key while OpenAI is restricted to official host',()=>{
 const r=aiRequest({...config,provider:'azure',endpoint:'https://sample.openai.azure.com',model:'deploy name',version:'2024-10-21'},'text');
 assert.equal(r.url,'https://sample.openai.azure.com/openai/deployments/deploy%20name/chat/completions?api-version=2024-10-21');assert.equal(r.options.headers['api-key'],config.key);assert.ok(!JSON.parse(r.options.body).model);
 assert.throws(()=>aiRequest({...config,provider:'openai'},'text'));
 for(const endpoint of ['http://ai.internal','https://news-calendar-api.pages.dev','https://x.workers.dev','https://ugiyo.github.io','https://user:pass@ai.internal','https://ai.internal?key=secret'])assert.throws(()=>aiRequest({...config,endpoint},'text'));
});
test('local persistence is explicit and clearing removes remembered key',()=>{
 const values=new Map(),storage={getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)};
 saveAISettings(config,false,storage);assert.equal(values.size,0);saveAISettings(config,true,storage);assert.equal(readAISettings(storage).key,config.key);saveAISettings(config,false,storage);assert.equal(readAISettings(storage).key,'');
});
test('errors do not expose provider response which may echo secrets, and never fall back to backend',async()=>{
 let count=0;await assert.rejects(requestAI(config,'text',{fetcher:async()=>{count++;return {ok:false,status:401,json:async()=>({error:config.key})};}}),e=>e.message.includes('401')&&!e.message.includes(config.key));assert.equal(count,1);
 await assert.rejects(requestAI(config,'text',{fetcher:async()=>{throw Error(config.key);}}),e=>e.message.includes('CORS')&&!e.message.includes(config.key));
});
