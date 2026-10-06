import test from 'node:test';
import assert from 'node:assert/strict';
import {aiRequest,requestAI,saveAISettings,readAISettings,pairLocalBridge,summarizeFullNews} from '../src/local-ai.js';
const config={provider:'litellm',endpoint:'https://ai.example.internal/v1',model:'company-model',key:'private-token'};
test('personal key is only in direct provider auth header, never URL or prompt; redirects and cookies blocked',async()=>{
 let calls=0;
 const answer=await requestAI(config,'新聞內容',{fetcher:async(url,options)=>{calls++;assert.equal(url,'https://ai.example.internal/v1/chat/completions');assert.equal(options.headers.Authorization,'Bearer private-token');assert.equal(options.credentials,'omit');assert.equal(options.redirect,'error');assert.equal(options.referrerPolicy,'no-referrer');assert.ok(!url.includes(config.key));assert.ok(!options.body.includes(config.key));return {ok:true,json:async()=>({choices:[{message:{content:'摘要'}}]})};}});
 assert.equal(answer,'摘要');assert.equal(calls,1);
});
test('Azure uses encoded deployment and api-key while OpenAI is restricted to official host',()=>{
 const r=aiRequest({...config,provider:'azure',endpoint:'https://sample.openai.azure.com',model:'deploy name',version:'2024-10-21'},'text');
 assert.equal(r.url,'https://sample.openai.azure.com/openai/deployments/deploy%20name/chat/completions?api-version=2024-10-21');assert.equal(r.options.headers['api-key'],config.key);assert.ok(!JSON.parse(r.options.body).model);
 assert.throws(()=>aiRequest({...config,provider:'openai'},'text'));
 for(const endpoint of ['http://ai.internal','https://news-calendar-api.pages.dev','https://x.workers.dev','https://ugiyo.github.io','https://user:pass@ai.internal','https://ai.internal?key=secret'])assert.throws(()=>aiRequest({...config,endpoint},'text'));
});
test('local persistence is explicit and clearing removes remembered key',()=>{
 const values=new Map(),storage={getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)};
 saveAISettings(config,false,storage);assert.equal(values.size,0);saveAISettings(config,true,storage);assert.equal(readAISettings(storage).key,config.key);saveAISettings(config,false,storage);assert.equal(readAISettings(storage).key,'');
});
test('errors do not expose provider response which may echo secrets, and never fall back to backend',async()=>{
 let count=0;await assert.rejects(requestAI(config,'text',{fetcher:async()=>{count++;return {ok:false,status:401,json:async()=>({error:config.key})};}}),e=>e.message.includes('401')&&!e.message.includes(config.key));assert.equal(count,1);
 await assert.rejects(requestAI(config,'text',{fetcher:async()=>{throw Error(config.key);}}),e=>e.message.includes('CORS')&&!e.message.includes(config.key));
});
test('Python transport sends key only to loopback and pairing code is never remembered',async()=>{
 const c={...config,transport:'python',bridge:'http://127.0.0.1:8765',bridgeToken:'random-pairing'};
 await requestAI(c,'news',{fetcher:async(url,options)=>{assert.equal(url,'http://127.0.0.1:8765/relay');assert.equal(options.headers['X-Local-AI-Token'],c.bridgeToken);assert.equal(options.headers.Authorization,undefined);assert.equal(JSON.parse(options.body).config.key,c.key);return {ok:true,json:async()=>({choices:[{message:{content:'ok'}}]})};}});
 let value;saveAISettings(c,true,{setItem:(_,v)=>value=v});assert.ok(!value.includes('random-pairing'));
 await assert.rejects(requestAI({...c,bridge:'http://outside.example'},'news'));
});

test('guided pairing verifies tool identity and sends pairing token without provider credentials',async()=>{
 const calls=[];await pairLocalBridge({bridge:'http://127.0.0.1:8765',bridgeToken:'pair-code',key:'private-key'},{fetcher:async(url,options)=>{calls.push(url);assert.ok(!JSON.stringify(options).includes('private-key'));if(url.endsWith('/health'))return {ok:true,json:async()=>({service:'stock-news-local-ai',version:3})};assert.equal(options.headers['X-Local-AI-Token'],'pair-code');return {ok:true,json:async()=>({paired:true})};}});assert.deepEqual(calls,['http://127.0.0.1:8765/health','http://127.0.0.1:8765/pair']);
 await assert.rejects(pairLocalBridge({bridge:'http://127.0.0.1:8765',bridgeToken:'x'},{fetcher:async()=>({ok:true,json:async()=>({service:'wrong-tool'})})}));
});

test('all news bodies are fetched before AI and total read failure prevents AI requests',async()=>{
 const rows=[{title:'A',url:'https://www.cna.com.tw/a',news_date:'2026-10-02'},{title:'B',url:'https://www.moneydj.com/b',news_date:'2026-10-02'}],c={...config,transport:'python',bridge:'http://127.0.0.1:8765',bridgeToken:'paired'},calls=[];
 const fetcher=async(url,options)=>{calls.push(url);if(url.endsWith('/health'))return {ok:true,json:async()=>({service:'stock-news-local-ai',version:3})};if(url.endsWith('/pair'))return {ok:true,json:async()=>({paired:true})};if(url.endsWith('/articles')){assert.ok(!options.body.includes(config.key));const requested=JSON.parse(options.body).url;return {ok:true,json:async()=>({url:requested,text:(requested.endsWith('/a')?'完整內文甲':'完整內文乙').repeat(100)})};}assert.ok(options.body.includes('完整內文甲'));assert.ok(options.body.includes('完整內文乙'));return {ok:true,json:async()=>({choices:[{message:{content:'combined'}}]})};};
 const result=await summarizeFullNews(rows,c,{fetcher});assert.equal(result.answer,'combined');assert.equal(result.articles.length,2);assert.ok(calls.lastIndexOf(c.bridge+'/articles')<calls.indexOf(c.bridge+'/relay'));
 let aiCalls=0;await assert.rejects(summarizeFullNews(rows,c,{fetcher:async(url)=>{if(url.endsWith('/health'))return {ok:true,json:async()=>({service:'stock-news-local-ai',version:3})};if(url.endsWith('/pair'))return {ok:true,json:async()=>({paired:true})};if(url.endsWith('/articles'))return {ok:false,json:async()=>({error:'付費牆'})};aiCalls++;throw Error('must not call AI');}}),/沒有以標題或舊摘要替代/);assert.equal(aiCalls,0);
});

test('mobile OpenAI retrieves article bodies without loopback and sends key only to OpenAI',async()=>{
 let read=0,ai=0;const c={...config,provider:'openai',endpoint:'https://api.openai.com/v1',transport:'direct',bridgeToken:''};
 const result=await summarizeFullNews([{title:'新聞',url:'https://www.cna.com.tw/story',news_date:'2026-10-02'}],c,{articleFetcher:async(url)=>{assert.equal(url,'https://www.cna.com.tw/story');read++;return {url,text:'完整新聞內文'.repeat(100)};},fetcher:async(url,options)=>{assert.equal(read,1);assert.equal(url,'https://api.openai.com/v1/chat/completions');assert.equal(options.headers.Authorization,'Bearer '+c.key);assert.ok(!options.body.includes(c.key));ai++;return {ok:true,json:async()=>({choices:[{message:{content:'mobile summary'}}]})};}});assert.equal(result.answer,'mobile summary');assert.equal(ai,1);
});


test('partial article failures are reported and only successful bodies are sent to AI',async()=>{
 const rows=[{title:'Failed headline',url:'https://www.moneydj.com/failed',article_summary:'OLD SUMMARY'},{title:'Success',url:'https://www.cna.com.tw/ok'}],reads=[];let calls=0;
 const result=await summarizeFullNews(rows,{...config,transport:'direct'},{articleFetcher:async(url)=>{reads.push(url);if(url.endsWith('/failed'))throw Error('來源 HTTP 403');return {url,text:'完整成功內文。'.repeat(30)};},fetcher:async(url,options)=>{calls++;assert.equal(reads.length,2);assert.ok(options.body.includes('完整成功內文'));assert.ok(options.body.includes('部分新聞摘要'));assert.ok(!options.body.includes('Failed headline'));assert.ok(!options.body.includes('OLD SUMMARY'));return {ok:true,json:async()=>({choices:[{message:{content:'partial summary'}}]})};}});
 assert.equal(calls,1);assert.equal(result.answer,'partial summary');assert.equal(result.total,2);assert.equal(result.articles.length,1);assert.deepEqual(result.failed,[{title:'Failed headline',url:rows[0].url,reason:'來源 HTTP 403'}]);
});

test('public provider network failures report stage and host without implying company VPN or exposing key',async()=>{
 const c={provider:'openai',endpoint:'https://api.openai.com/v1',model:'chat',key:'secret'};
 await assert.rejects(requestAI(c,'text',{fetcher:async()=>{throw new TypeError('secret');}}),e=>e.message.includes('AI 摘要')&&e.message.includes('api.openai.com')&&e.message.includes('HTTP')&&!e.message.includes('VPN')&&!e.message.includes('secret'));
});
