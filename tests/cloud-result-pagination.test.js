import test from 'node:test';import assert from 'node:assert/strict';import {aiJobsRoute} from '../worker/ai-jobs.js';
test('cloud task pages preserve session owner and include older results beyond first 100',async()=>{
 const calls=[];const records=Array.from({length:105},(_,i)=>({id:'t'+i,title:'result',kind:'news',date:'2026-10-07',status:'done',progress:'done',updated_at:Date.now()-i,output:'{"answer":"paid","text":""}'}));
 const db={prepare:q=>({bind:(...args)=>({run:async()=>({}),all:async()=>{calls.push({q,args});return {results:args[0]==='one'?records.slice(args[1],args[1]+100):[]};}})})};
 const get=(who,offset)=>aiJobsRoute(new Request('https://api.example/ai-jobs?offset='+offset),{DB:db},{user:{id:who},reply:(data,status=200)=>({data,status})});
 assert.equal((await get('one',0)).data.tasks.length,100);const older=await get('one',100);assert.equal(older.data.owner_id,'one');assert.equal(older.data.tasks.length,5);assert.equal(older.data.has_more,false);assert.equal((await get('two',0)).data.tasks.length,0);assert.equal((await get('one',-1)).status,400);assert.ok(calls.every(c=>c.q.includes('WHERE user_id=?')));
});
