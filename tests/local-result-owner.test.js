import test from 'node:test';import assert from 'node:assert/strict';
import {setResultOwner,resultRecords} from '../src/ai-results.js';import {submitLocalTask,startLocalSync,localResultAction} from '../src/local-background.js';
test('local background tasks bind to submitting user and other users cannot import or operate them',async()=>{
 const data=new Map();globalThis.localStorage={get length(){return data.size},key:i=>[...data.keys()][i],getItem:k=>data.get(k)||null,setItem:(k,v)=>data.set(k,v)};setResultOwner('local-user-one');const config={provider:'litellm',transport:'python',bridge:'http://127.0.0.1:8080/',bridgeToken:'pairing-secret'};
 const task={id:'owned-task',title:'paid',kind:'podcast',state:'complete',answer:'paid result',text:'transcript',updated_at:'2026-10-07T05:00:00Z'};
 const fetcher=async(url)=>Response.json(url.endsWith('/health')?{service:'stock-news-local-ai',version:5,local_jobs:true}:{task});await submitLocalTask({config,title:'paid',kind:'podcast'},{fetcher});assert.ok(resultRecords('local-user-one').some(r=>r.id==='local:owned-task'));assert.ok(![...data.values()].join().includes('pairing-secret'));
 globalThis.fetch=async()=>Response.json({tasks:[task,{...task,id:'unowned-task',answer:'someone else'}]});startLocalSync(config);await new Promise(resolve=>setTimeout(resolve,0));assert.ok(!resultRecords('local-user-one').some(r=>r.id==='local:unowned-task'));
 setResultOwner('local-user-two');startLocalSync(config);await new Promise(resolve=>setTimeout(resolve,0));assert.equal(resultRecords('local-user-two',true).length,0);await assert.rejects(localResultAction('owned-task','delete',config),/未綁定目前登入帳號/);
});
