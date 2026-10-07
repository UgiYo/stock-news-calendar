import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readAssistantThreads,saveAssistantThreads} from '../src/assistant-threads.js';
test('device threads retain turns, sources and stock context, isolated by account',()=>{const data=new Map(),storage={getItem:k=>data.get(k)||null,setItem:(k,v)=>data.set(k,v)};const rows=[{id:'one',title:'國巨',turns:[{question:'國巨新聞',answer:'內容 [S1]',sources:[{id:'S1',url:'https://example.com'}]}],stocks:[{code:'2327',name:'國巨'}]}];saveAssistantThreads('a',rows,storage);assert.deepEqual(readAssistantThreads('a',storage),rows);assert.deepEqual(readAssistantThreads('b',storage),[]);});
test('invalid stored thread data does not block assistant',()=>{assert.deepEqual(readAssistantThreads('a',{getItem:()=>'{broken'}),[]);assert.deepEqual(readAssistantThreads('a',{getItem:()=>'{}'}),[]);});
