import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import sourceWorker from '../worker/index.js';
import bundledWorker from '../worker/worker-bundle.js';
import {createRankingRefresher} from '../src/ranking-refresh.js';

function database(){
 const sqlite=new DatabaseSync(':memory:');
 return {sqlite,prepare(q){return {bind(...args){return {async run(){return sqlite.prepare(q).run(...args);},async first(){return sqlite.prepare(q).get(...args)||null;},async all(){return {results:sqlite.prepare(q).all(...args)};}};}};}};
}
for(const [label,worker] of [['source',sourceWorker],['bundle',bundledWorker]]){
 test(label+': authenticated shared update dispatches once and reports official data date',async()=>{
  const DB=database(),env={DB,APP_URL:'https://ugiyo.github.io/stock-news-calendar/',COLLECTOR_SECRET:'test-collector',GITHUB_DISPATCH_TOKEN:'test-dispatch',GITHUB_REPO:'UgiYo/stock-news-calendar'};
  const hash=Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode('test-session'))).toString('hex');
  DB.sqlite.exec('CREATE TABLE users(id TEXT PRIMARY KEY,email TEXT); CREATE TABLE sessions(token_hash TEXT,user_id TEXT,expires_at INTEGER)');
  DB.sqlite.prepare('INSERT INTO users VALUES(?,?)').run('user-1','test@example.invalid');
  DB.sqlite.prepare('INSERT INTO sessions VALUES(?,?,?)').run(hash,'user-1',Date.now()+60000);
  const call=(path,body,token='test-session')=>worker.fetch(new Request('https://api.example.invalid'+path,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined}),env);
  assert.equal((await worker.fetch(new Request('https://api.example.invalid/ranking-refresh',{method:'POST'}),env)).status,401);
  const original=globalThis.fetch,calls=[];
  globalThis.fetch=async(url,options)=>{calls.push({url:String(url),body:JSON.parse(options.body)});return new Response(null,{status:204});};
  try{
   const response=await call('/ranking-refresh',{});assert.equal(response.status,202);
   const {job}=await response.json();assert.equal(job.status,'pending');
   assert.equal(calls.length,1);assert.ok(calls[0].url.endsWith('/ranking.yml/dispatches'));
   assert.deepEqual(calls[0].body,{ref:'main',inputs:{refresh_id:job.id}});
   const duplicate=await (await call('/ranking-refresh',{})).json();assert.equal(duplicate.job.id,job.id);assert.equal(calls.length,1);
   assert.equal((await call('/admin/ranking-refresh',{id:job.id,status:'done'},'wrong-secret')).status,403);
   await call('/admin/ranking-refresh',{id:job.id,status:'running'},'test-collector');
   assert.equal((await (await call('/ranking-refresh?id='+job.id)).json()).job.status,'running');
   await call('/admin/ranking-refresh',{id:job.id,status:'done',data_date:'2026-10-07'},'test-collector');
   const done=await (await call('/ranking-refresh?id='+job.id)).json();assert.equal(done.job.status,'done');assert.equal(done.job.data_date,'2026-10-07');
   await call('/admin/ranking-refresh',{id:job.id,status:'failed',error:'late callback'},'test-collector');
   assert.equal((await (await call('/ranking-refresh?id='+job.id)).json()).job.status,'done');
   globalThis.fetch=async()=>new Response(null,{status:403});
   assert.equal((await call('/ranking-refresh',{})).status,502);
   assert.equal((await (await call('/ranking-refresh')).json()).job.status,'failed');
  }finally{globalThis.fetch=original;DB.sqlite.close();}
 });
}

test('website polls progress and reloads ranking only after success',async()=>{
 const requests=[],messages=[],jobs=[{id:'shared',status:'pending'},{id:'shared',status:'running'},{id:'shared',status:'done',data_date:'2026-10-07'}];
 let reloads=0;
 const controller=createRankingRefresher({owner:()=> 'user-1',request:async(path,options)=>{requests.push({path,options});return {job:jobs.shift()};},reload:async()=>{reloads++;},onChange:()=>messages.push(controller.state.message),wait:async()=>{}});
 await controller.start();
 assert.equal(requests[0].path,'/ranking-refresh');assert.deepEqual(requests[0].options,{body:{}});
 assert.equal(requests[1].path,'/ranking-refresh?id=shared');assert.equal(reloads,1);
 assert.ok(messages.some(m=>m.includes('等待處理')));assert.ok(messages.some(m=>m.includes('官方收盤資料')));
 assert.match(controller.state.message,/2026-10-07/);assert.equal(controller.state.busy,false);
});
test('failure keeps the current ranking and allows retry',async()=>{
 let reloads=0;
 const controller=createRankingRefresher({owner:()=> 'user-1',request:async()=>({job:{id:'shared',status:'failed',error:'官方資料尚未齊全'}}),reload:async()=>{reloads++;},onChange:()=>{},wait:async()=>{}});
 await controller.start();assert.equal(reloads,0);assert.equal(controller.state.message,'官方資料尚未齊全');assert.equal(controller.state.busy,false);
});
test('returning to the ranking resumes a pending shared update',async()=>{
 const requests=[],jobs=[{id:'shared',status:'running'},{id:'shared',status:'done',data_date:'2026-10-06'}];
 const controller=createRankingRefresher({owner:()=> 'user-1',request:async(path,options)=>{requests.push({path,options});return {job:jobs.shift()};},reload:async()=>{},onChange:()=>{},wait:async()=>{}});
 await controller.resume();assert.equal(requests[0].options,undefined);assert.match(controller.state.message,/2026-10-06/);
});
test('changing account stops polling and prevents stale results from reloading',async()=>{
 let who='first',reloads=0,requests=0;
 const controller=createRankingRefresher({owner:()=>who,request:async()=>{requests++;return {job:{id:'shared',status:'pending'}};},reload:async()=>{reloads++;},onChange:()=>{},wait:async()=>{who='second';}});
 await controller.start();assert.equal(requests,1);assert.equal(reloads,0);assert.equal(controller.state.message,'');assert.equal(controller.state.busy,false);
});
