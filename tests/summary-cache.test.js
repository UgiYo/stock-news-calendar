import test from 'node:test';
import assert from 'node:assert/strict';
import {cachedSummary} from '../src/summary-cache.js';
const config={provider:'openai',endpoint:'https://api.openai.com/v1',model:'test',key:'NEVER_SEND'};
test('company and Python summaries never contact shared backend and reuse local output',async()=>{
 for(const c of [{...config,provider:'litellm'},{...config,transport:'python'}]){
  const values=new Map(),storage={getItem:k=>values.get(k),setItem:(k,v)=>values.set(k,v)};let count=0;
  const options={shared:true,storage,call:()=>{throw Error('must not contact backend');}};
  assert.equal(await cachedSummary(c,'private',async()=>{count++;return 'local';},options),'local');
  assert.equal(await cachedSummary(c,'private',async()=>{count++;return 'again';},options),'local');assert.equal(count,1);
 }
});
test('shared hit avoids model; busy lease prevents duplicate generation; payload has no input or credentials',async()=>{
 const call=async(path,{body})=>{assert.deepEqual(Object.keys(body).sort(),['action','key']);assert.equal(body.key.length,64);return {answer:'shared'};};
 assert.equal(await cachedSummary(config,'public article',()=>{throw Error('must not generate');},{shared:true,call}),'shared');
 await assert.rejects(()=>cachedSummary(config,'public article',()=>{throw Error('must not generate');},{shared:true,call:async()=>({pending:true})}),/其他使用者/);
});
test('content or model change produces new keys and failed model releases lease',async()=>{
 const keys=[],actions=[];const call=async(path,{body})=>{actions.push(body.action);keys.push(body.key);return {lease:'lease'};};
 for(const [c,text] of [[config,'a'],[config,'b'],[{...config,model:'other'},'a']])await assert.rejects(()=>cachedSummary(c,text,async()=>{throw Error('model failed');},{shared:true,call}),/model failed/);
 assert.equal(new Set(keys).size,3);assert.deepEqual(actions,['claim','release','claim','release','claim','release']);
});
