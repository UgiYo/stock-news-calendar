import test from 'node:test';
import assert from 'node:assert/strict';
import {parseHTML} from 'linkedom';
import {captureScrollView,restoreScrollView,scrollWithin} from '../src/scroll-view.js';
import {setResultOwner,saveResult,openResultsCenter,openResultNotifications,refreshNotifications} from '../src/ai-results.js';
test('restores the same visible result when new content moves it, including expanded transcript',()=>{
 const {document}=parseHTML('<section><article data-result="a"><details><summary>text</summary></details></article></section>'),container=document.querySelector('section');container.scrollTop=120;container.scrollLeft=7;let offset=150;
 container.getBoundingClientRect=()=>({top:0,bottom:300});container.querySelector('article').getBoundingClientRect=()=>({top:offset-container.scrollTop,bottom:offset+100-container.scrollTop});container.querySelector('details').open=true;
 const view=captureScrollView(container);offset=250;container.scrollTop=0;container.querySelector('details').open=false;container.querySelector('article').insertAdjacentHTML('afterbegin','<details><summary>new failure</summary></details>');restoreScrollView(container,view);
 assert.equal(container.scrollTop,220);assert.equal(container.scrollLeft,7);assert.equal(container.querySelectorAll('details')[1].open,true);assert.ok(!container.querySelector('details').open);
 let ancestorsScrolled=false;const node={getBoundingClientRect:()=>({top:180}),scrollIntoView:()=>{ancestorsScrolled=true;}};scrollWithin(container,node);assert.equal(container.scrollTop,400);assert.equal(ancestorsScrolled,false);
});
test('notifications and results preserve positions on updates, returns and reopening',()=>{
 const {window,document}=parseHTML('<html><body><button id="ai-notifications"></button></body></html>');Object.assign(globalThis,{window,document,CustomEvent:window.CustomEvent});
 window.scrollX=0;window.scrollY=800;window.scrollTo=options=>{window.scrollX=options.left;window.scrollY=options.top;};let ancestorScrolls=0;window.HTMLElement.prototype.scrollIntoView=()=>ancestorScrolls++;window.HTMLElement.prototype.focus=function(){};
 const data=new Map();globalThis.localStorage={get length(){return data.size;},key:i=>[...data.keys()][i],getItem:k=>data.get(k)||null,setItem:(k,v)=>data.set(k,String(v)),removeItem:k=>data.delete(k)};
 setResultOwner('scroll-owner');const meta={id:'result-a',title:'Podcast',kind:'podcast'};saveResult(meta,{answer:'report',text:'transcript',state:'complete'});
 openResultNotifications();let notices=document.querySelector('.ai-notification-panel');notices.scrollTop=180;refreshNotifications();assert.equal(notices.scrollTop,180);openResultNotifications();openResultNotifications();notices=document.querySelector('.ai-notification-panel');assert.equal(notices.scrollTop,180);
 openResultsCenter();let center=document.querySelector('#ai-results-center');center.scrollTop=450;center.querySelector('details').open=true;
 saveResult(meta,{answer:'new report',text:'transcript',state:'complete'});assert.equal(center.scrollTop,450);assert.equal(center.querySelector('details').open,true);assert.equal(notices.scrollTop,180);
 openResultsCenter('result-a');assert.equal(ancestorScrolls,0);center.querySelector('#back-to-results').click();assert.equal(center.scrollTop,450);assert.equal(center.querySelector('details').open,true);
 center.querySelector('#close-results').click();assert.equal(window.scrollY,800);openResultsCenter();center=document.querySelector('#ai-results-center');assert.equal(center.scrollTop,450);
 center.querySelector('#close-results').click();openResultNotifications();setResultOwner('another-owner');assert.equal(document.querySelector('#ai-results-center'),null);delete globalThis.document;delete globalThis.window;delete globalThis.CustomEvent;
});
