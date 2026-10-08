import test from 'node:test';
import assert from 'node:assert/strict';
import {parseHTML} from 'linkedom';
import {setResultOwner,saveResult,openResultsCenter,runResultJob} from '../src/ai-results.js';

test('active tasks appear once, separate from outcomes, and move on completion or cancellation',async()=>{
 const {window,document}=parseHTML('<html><body></body></html>');
 Object.assign(globalThis,{window,document,CustomEvent:window.CustomEvent});
 const data=new Map();globalThis.localStorage={get length(){return data.size;},key:i=>[...data.keys()][i],getItem:k=>data.get(k)||null,setItem:(k,v)=>data.set(k,String(v)),removeItem:k=>data.delete(k)};
 try{
 setResultOwner('task-owner');
 const meta=id=>({id,title:id,kind:'news'});
 saveResult(meta('finished'),{answer:'complete',state:'complete'});
 saveResult(meta('queued'),{cloud_id:'cloud-q',state:'queued',progress:'waiting'});
 saveResult(meta('local'),{local_id:'local-r',state:'running',progress:'transcribing'});
 saveResult({...meta('interrupted'),request:{rows:[]}},{state:'interrupted',progress:'network stopped'});
 saveResult(meta('other-owner'),{cloud_id:'cloud-other',state:'running'},'another-user');
 let finish;const pending=runResultJob(meta('device'),()=>new Promise(resolve=>{finish=resolve;}));
 openResultsCenter();const center=document.querySelector('#ai-results-center');
 assert.equal(center.querySelectorAll('.result-task-section [data-result]').length,3);
 assert.equal(center.querySelectorAll('[data-result="device"]').length,1);
 assert.equal(center.querySelectorAll('.result-completed-section [data-result]').length,1);
 assert.ok(center.querySelector('.result-waiting-section [data-resume-news]'));
 assert.ok(center.querySelector('.result-task-section [data-local-cancel]'));
 assert.equal(center.querySelector('[data-result="other-owner"]'),null);
 center.querySelector('[data-result-category="podcast"]').click();
 assert.equal(center.querySelectorAll('.result-task-section [data-result]').length,3);
 center.querySelector('[data-result-category="all"]').click();center.scrollTop=240;
 finish({answer:'generated'});await pending;
 assert.equal(center.querySelector('[data-result="device"]').closest('section').className,'result-completed-section');
 assert.equal(center.querySelectorAll('[data-result="device"]').length,1);assert.equal(center.scrollTop,240);
 const cancel=runResultJob(meta('cancelled'),signal=>new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(Error('已取消')),{once:true})));
 const rejected=assert.rejects(cancel,/已取消/);
 center.querySelector('[data-cancel="cancelled"]').click();await rejected;
 assert.ok(center.querySelector('.result-waiting-section [data-result="cancelled"]'));
 assert.equal(center.querySelector('.result-completed-section [data-result="cancelled"]'),null);
 center.querySelector('#close-results').click();
 }finally{setResultOwner('guest');delete globalThis.document;delete globalThis.window;delete globalThis.CustomEvent;delete globalThis.localStorage;}
});
