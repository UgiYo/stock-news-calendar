import {test} from 'node:test';
import assert from 'node:assert/strict';
import {independentSTTRequest,readSTTSettings,saveSTTSettings} from '../src/podcast-stt.js';
import {transcribePodcast} from '../src/podcast-ai.js';
const stt={enabled:true,endpoint:'https://voice.example/v1/audio/transcriptions',model:'smg-whisper',key:'voice-secret'};
test('independent Whisper sends only model and file with api-key',()=>{
 const r=independentSTTRequest(stt,new Blob(['audio'],{type:'audio/wav'}));
 assert.equal(r.url,stt.endpoint);assert.deepEqual(r.options.headers,{'api-key':'voice-secret'});assert.deepEqual([...r.options.body.keys()],['model','file']);assert.equal(r.options.body.get('model'),'smg-whisper');
 assert.throws(()=>independentSTTRequest({...stt,endpoint:'http://voice.example/v1/audio/transcriptions'},new Blob(['a'])));
 assert.throws(()=>independentSTTRequest({...stt,key:''},new Blob(['a'])));
});
test('audio override leaves text AI settings intact and bypasses Python',async()=>{
 const config={provider:'litellm',transport:'python',endpoint:'https://text.example/v1',model:'text-model',key:'text-secret',stt};
 const result=await transcribePodcast(config,new Blob(['audio']),'whisper-1',{fetcher:async(url,options)=>{
  assert.equal(url,stt.endpoint);assert.equal(options.headers['api-key'],'voice-secret');assert.equal(options.body.get('model'),'smg-whisper');return {ok:true,json:async()=>({text:'逐字稿'})};
 }});
 assert.equal(result.transcription_model,'smg-whisper');assert.equal(config.key,'text-secret');assert.equal(config.model,'text-model');assert.equal(config.transport,'python');
});
test('settings can be cleared and reads cannot mutate stored settings',()=>{saveSTTSettings(stt);const copy=readSTTSettings();copy.key='other';assert.equal(readSTTSettings().key,'voice-secret');saveSTTSettings({});assert.equal(readSTTSettings().key,'');assert.equal(readSTTSettings().enabled,false);});
test('remember restores Whisper across reloads and clearing removes saved key',async()=>{
 const {loadSTTSettings,rememberSTTSettings}=await import('../src/podcast-stt.js');
 const data=new Map(),storage={getItem:k=>data.get(k)||null,setItem:(k,v)=>data.set(k,v),removeItem:k=>data.delete(k)};
 saveSTTSettings(stt,true,storage);assert.equal(rememberSTTSettings(storage),true);assert.equal(loadSTTSettings(storage).key,stt.key);
 saveSTTSettings(stt,false,storage);assert.equal(rememberSTTSettings(storage),false);assert.equal(loadSTTSettings(storage).key,'');
 saveSTTSettings({},false,storage);
});
