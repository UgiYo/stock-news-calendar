import test from 'node:test';import assert from 'node:assert/strict';
import {setSyncOwner,syncEnabled,setSyncEnabled,deviceRequest,deviceData,saveDeviceData,syncResultPayload} from '../src/account-sync.js';
function storage(){const rows=new Map();globalThis.localStorage={getItem:k=>rows.get(k)||null,setItem:(k,v)=>rows.set(k,v)};}
test('sync is opt in per account and device requests do not change cloud watchlists',async()=>{
 storage();setSyncOwner('one');assert.equal(syncEnabled(),false);saveDeviceData({companies:[{code:'2330'}],news:[]});const calls=[];const remote=async(path)=>{calls.push(path);return {companies:[{code:'2303'}]};};
 await deviceRequest('/watchlists',{body:{code:'2303'}},remote);await deviceRequest('/watchlists?code=2330',{method:'DELETE'},remote);assert.deepEqual(calls,['/companies?q=2303']);assert.deepEqual(deviceData().companies.map(c=>c.code),['2303']);
 setSyncEnabled(true);assert.equal(await deviceRequest('/watchlists',{},remote),undefined);setSyncOwner('two');assert.equal(syncEnabled(),false);assert.equal(deviceData(),null);
});
test('result sync contains no settings or continuation credentials and excludes company data',()=>{
 const row={id:'a',title:'analysis',kind:'text',updated_at:'2026-10-06T12:00:00Z',state:'complete',answer:'result',request:{key:'secret'},config:{token:'secret'},key:'secret'};
 assert.ok(!JSON.stringify(syncResultPayload(row)).includes('secret'));assert.equal(syncResultPayload({...row,local_only:true}),null);assert.equal(syncResultPayload({...row,local_id:'python'}),null);assert.equal(syncResultPayload({...row,state:'running'}),null);
});
