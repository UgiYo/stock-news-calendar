import test from 'node:test';import assert from 'node:assert/strict';import {accountResultsRoute} from '../worker/account-results.js';
test('server scopes identical result ids and every read/delete to verified user, rejecting client owner claims',async()=>{
 const rows=new Map();const calls=[];const sql=(q,...args)=>{calls.push({q,args});return {run:async()=>{if(q.startsWith('INSERT INTO account_results'))rows.set(args[0]+':'+args[1],{id:args[1],payload:args[2],updated_at:args[3]});return {};},all:async()=>({results:[...rows.entries()].filter(([k])=>k.startsWith(args[0]+':')).map(([,v])=>v).slice(args[1]||0,(args[1]||0)+200)})};};
 const route=(method,user,body)=>accountResultsRoute(new Request('https://api.example/account-results'+(method==='DELETE'?'?id=same':''),{method,...(body?{body:JSON.stringify(body)}:{})}),{sql,user:user?{id:user}:null,reply:(data,status=200)=>({data,status})});
 const base={id:'same',title:'result',kind:'news',date:'2026-10-07',updated_at:'2026-10-07T05:00:00Z',answer:'one',text:'source',partial:false,failures:[]};
 assert.equal((await route('GET',null)).status,401);assert.equal((await route('POST','one',{...base,owner:'two'})).status,400);
 await route('POST','one',base);await route('POST','two',{...base,answer:'two'});assert.deepEqual((await route('GET','one')).data.results.map(r=>r.answer),['one']);assert.equal((await route('GET','one')).data.owner_id,'one');assert.deepEqual((await route('GET','two')).data.results.map(r=>r.answer),['two']);await route('DELETE','one');assert.equal((await route('GET','one')).data.results.length,0);assert.deepEqual((await route('GET','two')).data.results.map(r=>r.answer),['two']);
 assert.ok(calls.filter(c=>c.q.startsWith('SELECT')).every(c=>c.q.includes('WHERE user_id=?')));
});
