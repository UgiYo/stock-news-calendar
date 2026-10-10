import test from 'node:test';import assert from 'node:assert/strict';
import {setSyncOwner,syncEnabled,setSyncEnabled,deviceRequest,deviceData,saveDeviceData,syncResultPayload} from '../src/account-sync.js';
function storage(){const rows=new Map();globalThis.localStorage={getItem:k=>rows.get(k)||null,setItem:(k,v)=>rows.set(k,v)};}
test('sync is opt in per account and device requests do not change cloud watchlists',async()=>{
 storage();setSyncOwner('one');assert.equal(syncEnabled(),false);saveDeviceData({companies:[{code:'2330'}],news:[]});const calls=[];const remote=async(path)=>{calls.push(path);return {companies:[{code:'2303'}]};};
 await deviceRequest('/watchlists',{body:{code:'2303'}},remote);await deviceRequest('/watchlists?code=2330',{method:'DELETE'},remote);assert.deepEqual(calls,['/companies?q=2303']);assert.deepEqual(deviceData().companies.map(c=>c.code),['2303']);
 setSyncEnabled(true);assert.equal(await deviceRequest('/watchlists',{},remote),undefined);setSyncOwner('two');assert.equal(syncEnabled(),false);assert.equal(deviceData(),null);
});
test('completed results sync only for their logged-in owner and never include credentials',()=>{
 storage();setSyncOwner('one');const row={owner:'one',id:'a',title:'analysis',kind:'text',updated_at:'2026-10-06T12:00:00Z',state:'complete',answer:'result',request:{key:'secret'},config:{token:'secret'},key:'secret',episode:{title:'source',url:'https://example.com/episode',key:'secret'}};
 assert.ok(!JSON.stringify(syncResultPayload(row)).includes('secret'));assert.ok(syncResultPayload({...row,local_only:true}));assert.ok(syncResultPayload({...row,local_id:'python'}));assert.equal(syncResultPayload({...row,owner:'two'}),null);assert.equal(syncResultPayload({...row,owner:'guest'}),null);assert.equal(syncResultPayload({...row,state:'running'}),null);setSyncOwner('guest');assert.equal(syncResultPayload(row),null);
});
test('device news update falls back to collector and imports completed shared news without syncing watchlist',async()=>{
 storage();setSyncOwner('one');saveDeviceData({companies:[{code:'6515'}],news:[{company_code:'2330',url:'https://same',title:'other company'}]});const calls=[];
 const remote=async(path,options)=>{calls.push([path,options]);if(path.startsWith('/preview?code='))throw Object.assign(Error('source HTTP 429'),{status:502});return {job:{id:'public-collect',status:'pending'},dispatched:true};};
 const first=await deviceRequest('/collect',{body:{code:'6515'}},remote);assert.deepEqual(first.deviceCollection,{code:'6515',owner:'one'});assert.equal(calls[1][0],'/device-collect');assert.deepEqual(calls[1][1].body,{code:'6515'});assert.equal(deviceData().news.length,1);
 const {finishDeviceCollection}=await import('../src/account-sync.js');await finishDeviceCollection(first.deviceCollection,async path=>{assert.equal(path,'/preview?stored=1&code=6515');return {news:[{company_code:'6515',url:'https://same',title:'穎崴新聞'}]};});assert.equal(deviceData().news.length,2);
 setSyncOwner('two');await assert.rejects(finishDeviceCollection(first.deviceCollection,async()=>{throw Error('must not fetch');}),/登入帳號已變更/);
});
test('device collector does not bypass login errors or exhausted D1 quota',async()=>{
 storage();setSyncOwner('one');saveDeviceData({companies:[{code:'6515'}],news:[]});
 for(const error of [Object.assign(Error('login'),{status:401}),Object.assign(Error('quota'),{status:503,code:'D1_READ_QUOTA'})]){let calls=0;await assert.rejects(deviceRequest('/collect',{body:{code:'6515'}},async()=>{calls++;throw error;}));assert.equal(calls,1);}
});
