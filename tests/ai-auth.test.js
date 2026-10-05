import test from 'node:test';
import assert from 'node:assert/strict';
import {requireAISession} from '../src/ai-auth.js';
test('anonymous AI start rejects before any request',async()=>{await assert.rejects(requireAISession({storage:{getItem:()=>null},request:()=>{throw Error('must not call');}}),/請先登入/);});
test('AI start requires valid server session',async()=>{await assert.rejects(requireAISession({storage:{getItem:()=> 'token'},request:async()=>({user:null})}),/登入狀態/);});
test('logout during session validation blocks AI start',async()=>{let token='saved';await assert.rejects(requireAISession({storage:{getItem:()=>token},request:async()=>{token=null;return {user:{id:'alice'}};}}),/登入狀態/);});
test('valid session allows AI start',async()=>{assert.equal((await requireAISession({storage:{getItem:()=> 'token'},request:async()=>({user:{id:'alice'}})})).id,'alice');});
