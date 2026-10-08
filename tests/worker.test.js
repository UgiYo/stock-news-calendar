import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import worker,{hash,verifyGoogle,extractArticleBody,checkedArticleURL,normalizeArticleURL,readArticleURL,parseCompanyProfile} from '../worker/index.js';
function setup(){const db=new DatabaseSync(':memory:');db.exec(readFileSync(new URL('../worker/migrations/0001_init.sql',import.meta.url),'utf8'));const adapter={prepare(q){return {bind(...args){const s=db.prepare(q);return {async first(){return s.get(...args)||null},async all(){return {results:s.all(...args)}},async run(){return s.run(...args)}}}}},async batch(list){return Promise.all(list.map(x=>x.run()))}};return {db,env:{DB:adapter,APP_URL:'https://example.com/',GOOGLE_CLIENT_ID:'client',COLLECTOR_SECRET:'secret',GITHUB_REPO:'owner/repo'}};}
async function call(env,path,token,body,method){return worker.fetch(new Request('https://worker.example'+path,{method:method||(body?'POST':'GET'),headers:token?{Authorization:'Bearer '+token}:{},body:body?JSON.stringify(body):undefined}),env);}
test('shared summaries reuse across users and only lease owner can publish',async()=>{
 const {db,env}=setup();for(const id of ['alice','bob']){db.prepare('INSERT INTO users VALUES(?,?)').run(id,id+'@example.com');db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(await hash(id),id,Date.now()+60000);}
 const key='a'.repeat(64),body={key,action:'claim'};
 assert.equal((await call(env,'/summary-cache',null,body)).status,401);
 const a=await (await call(env,'/summary-cache','alice',body)).json();assert.ok(a.lease);
 assert.equal((await (await call(env,'/summary-cache','bob',body)).json()).pending,true);
 assert.equal((await call(env,'/summary-cache','bob',{key,action:'save',lease:a.lease,answer:'wrong'})).status,409);
 assert.equal((await call(env,'/summary-cache','alice',{key,action:'save',lease:a.lease,answer:'shared facts'})).status,200);
 assert.equal((await (await call(env,'/summary-cache','bob',body)).json()).answer,'shared facts');
 assert.equal((await call(env,'/summary-cache','alice',{...body,key:'private-key',config:{key:'secret'}})).status,400);db.close();
});
test('D1 API enforces user isolation and validates jobs',async()=>{const {db,env}=setup();for(const id of ['alice','bob']){db.prepare('INSERT INTO users VALUES(?,?)').run(id,id+'@example.com');db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(await hash(id),id,Date.now()+60000);}db.exec("INSERT INTO companies(code,name,full_name,market) VALUES('2330','台積電','台灣積體電路','上市');INSERT INTO news(company_code,title,url,source,published_at,news_date) VALUES('2330','台積電新聞','https://example.com/story','新聞','2026-10-02T01:00:00Z','2026-10-02');");assert.equal((await call(env,'/watchlists')).status,401);assert.equal((await call(env,'/admin/tracked','bad')).status,403);await call(env,'/watchlists','alice',{code:'2330'});assert.equal((await (await call(env,'/news?from=2026-10-01&to=2026-10-31','alice')).json()).news.length,1);assert.equal((await (await call(env,'/news?from=2026-10-01&to=2026-10-31','bob')).json()).news.length,0);assert.equal((await call(env,'/summarize','bob',{id:1})).status,403);const first=await (await call(env,'/summarize','alice',{id:1})).json();const second=await (await call(env,'/summarize','alice',{id:1})).json();assert.equal(first.job.id,second.job.id);assert.equal((await call(env,'/jobs?id='+first.job.id,'bob')).status,404);const jobs=(await (await call(env,'/admin/claim','secret',{})).json()).jobs;assert.equal(jobs.length,1);await call(env,'/admin/summary','secret',{id:1,article_summary:'內容摘要',summary_method:'extractive'});await call(env,'/admin/job','secret',{id:first.job.id});assert.equal((await (await call(env,'/jobs?id='+first.job.id,'alice')).json()).news.article_summary,'內容摘要');await call(env,'/logout','alice',{});assert.equal((await call(env,'/me','alice')).status,401);db.close();});
test('OAuth callback rejects missing state cookie; start enables PKCE',async()=>{const {db,env}=setup();assert.equal((await call(env,'/auth/callback?state=bad&code=x')).status,400);const r=await call(env,'/auth/start');assert.equal(r.status,302);assert.match(r.headers.get('Set-Cookie'),/HttpOnly/);assert.equal(new URL(r.headers.get('Location')).searchParams.get('code_challenge_method'),'S256');db.close();});
test('Google identity validation rejects unsigned tokens',async()=>{const encode=x=>Buffer.from(JSON.stringify(x)).toString('base64url');const token=encode({alg:'none'})+'.'+encode({aud:'client',iss:'accounts.google.com',exp:Date.now()/1000+60,sub:'id',email_verified:true})+'.fake';await assert.rejects(verifyGoogle(token,'client'));});
test('Google identity verifies signature, audience and expiration',async()=>{
 const pair=await crypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify']);
 const jwk=await crypto.subtle.exportKey('jwk',pair.publicKey);jwk.kid='fixture';const original=globalThis.fetch;
 globalThis.fetch=async()=>Response.json({keys:[jwk]});
 try{const enc=x=>Buffer.from(JSON.stringify(x)).toString('base64url');const claims={aud:'client',iss:'https://accounts.google.com',exp:Date.now()/1000+60,sub:'user',email:'a@example.com',email_verified:true};const input=enc({alg:'RS256',kid:'fixture'})+'.'+enc(claims);const signature=await crypto.subtle.sign('RSASSA-PKCS1-v1_5',pair.privateKey,new TextEncoder().encode(input));const token=input+'.'+Buffer.from(signature).toString('base64url');assert.equal((await verifyGoogle(token,'client')).sub,'user');await assert.rejects(verifyGoogle(token,'other-client'));await assert.rejects(verifyGoogle(input+'.'+Buffer.alloc(256).toString('base64url'),'client'));}finally{globalThis.fetch=original;}
});
test('missing or invalid APP_URL returns actionable configuration error',async()=>{
 for(const value of [undefined,'','example.com','javascript:bad']){const r=await call({APP_URL:value},'/');assert.equal(r.status,503);assert.match((await r.json()).error,/APP_URL/);}
 const r=await call({APP_URL:' https://example.com/ '},'/health');assert.equal(r.status,503);assert.ok((await r.json()).missing.includes('DB'));
});
test('cached extracts can explicitly retry AI while cached AI remains reusable',async()=>{
 const {db,env}=setup();db.prepare('INSERT INTO users VALUES(?,?)').run('alice','a@example.com');db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(await hash('alice'),'alice',Date.now()+60000);
 db.exec("INSERT INTO companies(code,name,full_name,market) VALUES('2330','台積電','台積電','上市');INSERT INTO watchlists VALUES('alice','2330','now');INSERT INTO news(company_code,title,url,source,published_at,news_date,article_summary,summary_method) VALUES('2330','台積電新聞','https://example.com/story','中央社','2026-10-02T01:00:00Z','2026-10-02','摘錄','extractive');");
 assert.equal((await (await call(env,'/summarize','alice',{id:1})).json()).job,undefined);
 assert.ok((await (await call(env,'/summarize','alice',{id:1,retry_ai:true})).json()).job);
 db.exec("UPDATE news SET summary_method='ai';");assert.equal((await (await call(env,'/summarize','alice',{id:1,retry_ai:true})).json()).job,undefined);db.close();
});
test('repeated news upload does not rewrite identical rows',async()=>{
 const {db,env}=setup();db.exec("INSERT INTO companies(code,name,full_name,market) VALUES('2303','聯電','聯華電子','上市');");
 const body={news:[{company_code:'2303',title:'聯電營收新聞',url:'https://example.com/umc',source:'中央社',published_at:'2026-10-02T01:00:00Z',news_date:'2026-10-02'}]};
 assert.equal((await call(env,'/admin/news','secret',body)).status,200);const before=db.prepare('SELECT total_changes() AS n').get().n;
 assert.equal((await call(env,'/admin/news','secret',body)).status,200);assert.equal(db.prepare('SELECT total_changes() AS n').get().n,before);assert.equal(db.prepare('SELECT COUNT(*) AS n FROM news').get().n,1);db.close();
});

test('ranking backfill preserves 60 snapshots and compares true preceding trading day',async()=>{const {db,env}=setup();db.prepare('INSERT INTO users VALUES(?,?)').run('alice','alice@example.com');db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(await hash('alice'),'alice',Date.now()+60000);const stocks=[{code:'2303',name:'聯電',market:'上市',tag:'半導體',amount:100}];assert.equal((await call(env,'/admin/ranking-dates','bad')).status,403);await call(env,'/admin/ranking','secret',{date:'2026-09-30',previousDate:'2026-09-29',stocks});await call(env,'/admin/ranking','secret',{date:'2026-10-01',previousDate:'2026-09-30',stocks});let result=await (await call(env,'/ranking','alice')).json();assert.equal(result.previousStocks.length,1);assert.equal(result.previousDate,'2026-09-30');assert.equal(result.history.length,2);for(let i=0;i<65;i++){const date=new Date(Date.UTC(2026,5,1+i)).toISOString().slice(0,10);await call(env,'/admin/ranking','secret',{date,stocks});}assert.equal((await (await call(env,'/admin/ranking-dates','secret')).json()).dates.length,60);result=await (await call(env,'/ranking?date=2026-09-30','alice')).json();assert.equal(result.stocks.length,1);assert.equal(result.previousStocks,null);assert.equal(result.dates.length,60);db.close();});

test('single stock ranking history reports full ranks and missing days without requiring watchlist',async()=>{const {db,env}=setup();db.prepare('INSERT INTO users VALUES(?,?)').run('alice','a@example.com');db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(await hash('alice'),'alice',Date.now()+60000);const stocks=Array.from({length:12},(_,i)=>({code:String(1000+i),name:'公司'+i,tag:'半導體',market:'上市',amount:120-i}));await call(env,'/admin/ranking','secret',{date:'2026-09-30',stocks});await call(env,'/admin/ranking','secret',{date:'2026-10-01',previousDate:'2026-09-30',stocks:stocks.map(r=>({...r,amount:r.code==='1011'?500:r.amount}))});const data=await (await call(env,'/ranking-stock?code=1011','alice')).json();assert.equal(data.history[0].rank,12);assert.equal(data.history[1].rank,1);assert.equal(data.stock.code,'1011');assert.equal((await call(env,'/ranking-stock?code=1011')).status,401);assert.equal((await call(env,'/ranking-stock?code=abc','alice')).status,400);db.close();});
test('OHLC chart reads shared prices without watchlist and preserves corrected high',async()=>{const {db,env}=setup();db.prepare('INSERT INTO users VALUES(?,?)').run('alice','a@example.com');db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(await hash('alice'),'alice',Date.now()+60000);const price={code:'2303',date:new Date().toISOString().slice(0,10),open:10,high:12,low:9,close:11,volume:100};await call(env,'/admin/prices','secret',{prices:[price]});await call(env,'/admin/prices','secret',{prices:[{...price,high:13}]});const data=await (await call(env,'/chart-prices?code=2303','alice')).json();assert.equal(data.prices[0].high,13);assert.equal((await call(env,'/chart-prices?code=2303')).status,401);db.close();});
test('intraday validates symbols and intervals and discards null or non-session bars',async()=>{const {db,env}=setup();db.prepare('INSERT INTO users VALUES(?,?)').run('alice','a@example.com');db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(await hash('alice'),'alice',Date.now()+60000);db.exec("INSERT INTO companies(code,name,full_name,market) VALUES('2303','聯電','聯華電子','上市')");const original=globalThis.fetch;globalThis.fetch=async()=>Response.json({chart:{result:[{meta:{symbol:'2303.TW'},timestamp:[Date.parse('2026-10-02T01:00:00Z')/1000,Date.parse('2026-10-02T07:00:00Z')/1000,Date.parse('2026-10-02T01:05:00Z')/1000],indicators:{quote:[{open:[10,10,null],high:[12,12,null],low:[9,9,null],close:[11,11,null],volume:[100,100,null]}]}}]}});try{assert.equal((await call(env,'/intraday?code=2303&interval=2m','alice')).status,400);const data=await (await call(env,'/intraday?code=2303&interval=5m','alice')).json();assert.equal(data.prices.length,1);assert.equal(data.prices[0].date,'2026-10-02 09:00');}finally{globalThis.fetch=original;db.close();}});
test('portfolio quote batch requires login and reads shared prices without storing holdings',async()=>{const {db,env}=setup();db.prepare('INSERT INTO users VALUES(?,?)').run('alice','a@example.com');db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(await hash('alice'),'alice',Date.now()+60000);await call(env,'/admin/prices','secret',{prices:[{code:'2303',date:'2026-09-30',close:50},{code:'2303',date:'2026-10-01',close:51}]});const before=db.prepare('SELECT total_changes() AS n').get().n;const data=await (await call(env,'/portfolio-quotes?codes=2303,0050','alice')).json();assert.equal(data.quotes.length,1);assert.equal(data.quotes[0].close,51);assert.equal(db.prepare('SELECT total_changes() AS n').get().n,before);assert.equal((await call(env,'/portfolio-quotes?codes=2303')).status,401);assert.equal((await call(env,'/portfolio-quotes?codes=abc','alice')).status,400);db.close();});

test('article reader only accepts public supported hosts and extracts article content, not menus',()=>{
 for(const url of ['http://www.cna.com.tw/a','https://127.0.0.1/a','https://user:pw@www.cna.com.tw/a','https://news.cnyes.com.evil.example/a'])assert.throws(()=>checkedArticleURL(url));
 const text='第一段新聞內容。'.repeat(50)+'最後一段重要數字。';assert.equal(extractArticleBody('<script type="application/ld+json">'+JSON.stringify({'@type':'NewsArticle',articleBody:text})+'</script>'),text);
 const parsed=extractArticleBody('<nav>navigation</nav><div class="centralContent"><p>'+text+'</p></div><footer>other stories</footer>');assert.ok(parsed.includes('最後一段重要數字'));assert.ok(!parsed.includes('other stories'));assert.throws(()=>extractArticleBody('<article>標題而已</article>'));
});
test('authenticated content route rejects AI settings and never invokes AI or writes news',async()=>{
 const {db,env}=setup();db.prepare('INSERT INTO users VALUES(?,?)').run('alice','a@example.com');db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(await hash('alice'),'alice',Date.now()+60000);assert.equal((await call(env,'/article-content',null,{url:'https://www.cna.com.tw/story'})).status,401);assert.equal((await call(env,'/article-content','alice',{url:'https://www.cna.com.tw/story',key:'must-not-upload'})).status,400);
 const original=globalThis.fetch;let calls=0;globalThis.fetch=async(url,options)=>{calls++;assert.equal(url,'https://www.cna.com.tw/story');assert.equal(options.headers.Authorization,undefined);return new Response('<article><p>'+'新聞內文。'.repeat(100)+'</p></article>');};try{const before=db.prepare('SELECT total_changes() AS n').get().n;const response=await call(env,'/article-content','alice',{url:'https://www.cna.com.tw/story'});assert.equal(response.status,200);assert.ok((await response.json()).text.includes('新聞內文'));assert.equal(calls,1);assert.equal(db.prepare('SELECT total_changes() AS n').get().n,before);}finally{globalThis.fetch=original;db.close();}
});

test('publisher aliases and known HTTP links normalize without opening other sources',()=>{
 assert.equal(normalizeArticleURL('http://www.moneydj.com/KMDJ/News/NewsViewer.aspx?a=123'),'https://www.moneydj.com/KMDJ/News/NewsViewer.aspx?a=123');assert.equal(normalizeArticleURL('https://m.moneydj.com/f1a.aspx?s=a&id=abc'),'https://www.moneydj.com/kmdj/news/newsviewer.aspx?a=abc');assert.equal(normalizeArticleURL('https://gfe-desktop.cnyes.com/news/id/6597598'),'https://news.cnyes.com/news/id/6597598');assert.equal(normalizeArticleURL('https://www.google.com/url?url='+encodeURIComponent('https://news.cnyes.com/news/id/1')),'https://news.cnyes.com/news/id/1');for(const url of ['https://www.google.com/url?q=https://evil.example','http://evil.example','https://user:pw@gfe-desktop.cnyes.com/news/id/1'])assert.throws(()=>normalizeArticleURL(url));
 assert.equal(extractArticleBody('<article>'+('短篇法說會完整公告。'.repeat(12))+'</article>'),'短篇法說會完整公告。'.repeat(12));
});
test('Google direct publisher redirects are read as articles without requiring RPC signature',async()=>{
 const original=globalThis.fetch;let calls=0;globalThis.fetch=async(url)=>{calls++;if(url.startsWith('https://news.google.com/'))return new Response(null,{status:302,headers:{Location:'http://www.moneydj.com/kmdj/news/newsviewer.aspx?a=123'}});assert.equal(url,'https://www.moneydj.com/kmdj/news/newsviewer.aspx?a=123');return new Response('<article>'+'完整原文末段。'.repeat(80)+'</article>');};try{const result=await readArticleURL('https://news.google.com/rss/articles/CBMopaque');assert.match(result.text,/完整原文末段/);assert.equal(calls,2);}finally{globalThis.fetch=original;}
});

test('saved original URL bypasses Google News and collector link updates preserve summaries',async()=>{
 const {db,env}=setup();db.prepare('INSERT INTO users VALUES(?,?)').run('alice','a@example.com');db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(await hash('alice'),'alice',Date.now()+60000);
 db.exec("INSERT INTO companies(code,name,full_name,market) VALUES('2303','聯電','聯華電子','上市')");
 await call(env,'/admin/news','secret',{news:[{company_code:'2303',title:'聯電法說會',url:'https://news.google.com/rss/articles/opaque',source:'MoneyDJ',published_at:'2026-09-03T01:00:00Z',news_date:'2026-09-03'}]});
 const id=db.prepare('SELECT id FROM news').get().id;db.prepare('UPDATE news SET article_summary=? WHERE id=?').run('existing summary',id);
 assert.equal((await call(env,'/admin/article-links',null,{id,url:'https://www.moneydj.com/story'})).status,403);
 assert.equal((await call(env,'/admin/article-links','secret',{id,url:'https://evil.example/story'})).status,400);
 assert.equal((await call(env,'/admin/article-links','secret',{id,url:'https://www.moneydj.com/story'})).status,200);
 assert.equal(db.prepare('SELECT article_summary FROM news').get().article_summary,'existing summary');
 const original=globalThis.fetch;globalThis.fetch=async(url)=>{assert.equal(url,'https://www.moneydj.com/story');return new Response('<article>'+'完整新聞最後一段。'.repeat(30)+'</article>');};
 try{const response=await call(env,'/article-content','alice',{url:'https://news.google.com/rss/articles/opaque'});assert.equal(response.status,200);assert.match((await response.json()).text,/最後一段/);}finally{globalThis.fetch=original;db.close();}
});

test('personal background tasks require consent, isolate users, encrypt keys and purge on completion',async()=>{
 const {db,env}=setup();env.GITHUB_DISPATCH_TOKEN='dispatch';for(const id of ['alice','bob']){db.prepare('INSERT INTO users VALUES(?,?)').run(id,id+'@example.com');db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(await hash(id),id,Date.now()+60000);}
 const body={kind:'news',title:'Daily',date:'2026-10-03',input:{rows:[{title:'Article',url:'https://www.cna.com.tw/news/a/123.aspx'}]},config:{provider:'openai',endpoint:'https://api.openai.com/v1',model:'model',key:'private-user-key',transport:'direct'}};
 assert.equal((await call(env,'/ai-jobs','alice',body)).status,400);
 const original=globalThis.fetch;globalThis.fetch=async()=>new Response(null,{status:204});
 try{const r=await call(env,'/ai-jobs','alice',{...body,consent:true});assert.equal(r.status,202);const {task}=await r.json();assert.ok(!JSON.stringify(task).includes('private-user-key'));const row=db.prepare('SELECT * FROM personal_ai_tasks WHERE id=?').get(task.id);assert.ok(!row.encrypted.includes('private-user-key'));assert.equal((await (await call(env,'/ai-jobs','bob')).json()).tasks.length,0);assert.equal((await (await call(env,'/ai-jobs','alice')).json()).tasks.length,1);
 const claimed=(await (await call(env,'/admin/ai-jobs/claim','secret',{})).json()).task;assert.equal(claimed.id,task.id);
 await call(env,'/admin/ai-jobs/update','secret',{id:task.id,lease:'wrong',status:'done',output:{answer:'wrong'}});assert.equal(db.prepare('SELECT status FROM personal_ai_tasks WHERE id=?').get(task.id).status,'running');
 await call(env,'/admin/ai-jobs/update','secret',{id:task.id,lease:claimed.lease,status:'done',progress:'done',output:{answer:'Summary',key:'must-not-store'}});const completed=db.prepare('SELECT * FROM personal_ai_tasks WHERE id=?').get(task.id);assert.equal(completed.encrypted,null);assert.ok(!completed.output.includes('must-not-store'));
 await call(env,'/ai-jobs/read','bob',{id:task.id});assert.equal(db.prepare('SELECT read_at FROM personal_ai_tasks WHERE id=?').get(task.id).read_at,null);await call(env,'/ai-jobs/read','alice',{id:task.id});assert.ok(db.prepare('SELECT read_at FROM personal_ai_tasks WHERE id=?').get(task.id).read_at);
 }finally{globalThis.fetch=original;db.close();}
});
test('cloud tasks reject private endpoints and unauthenticated clients',async()=>{const {cloudConfig,encryptTask}=await import('../worker/ai-jobs.js');assert.throws(()=>cloudConfig({provider:'azure',endpoint:'https://127.0.0.1',key:'key',model:'model'}));const id='task';const encrypted=await encryptTask({config:{key:'private-key'}},'secret',id),key=await crypto.subtle.importKey('raw',await crypto.subtle.digest('SHA-256',new TextEncoder().encode('personal-ai-jobs-v1:secret')),{name:'AES-GCM'},false,['decrypt']);const plaintext=await crypto.subtle.decrypt({name:'AES-GCM',iv:Buffer.from(encrypted.iv,'base64'),additionalData:new TextEncoder().encode(id)},key,Buffer.from(encrypted.data,'base64'));assert.equal(JSON.parse(new TextDecoder().decode(plaintext)).config.key,'private-key');await assert.rejects(crypto.subtle.decrypt({name:'AES-GCM',iv:Buffer.from(encrypted.iv,'base64'),additionalData:new TextEncoder().encode('different-task')},key,Buffer.from(encrypted.data,'base64')));const {env,db}=setup();assert.equal((await call(env,'/ai-jobs')).status,401);db.close();});

test('Podcast RSS proxy accepts large real-world feeds and enforces its size limit',async()=>{
 const {db,env}=setup(),original=globalThis.fetch;let bytes=4400000;
 globalThis.fetch=async()=>new Response('x'.repeat(bytes));
 try{
  const path='/podcasts/rss?url='+encodeURIComponent('https://feeds.soundon.fm/podcasts/example.xml');
  const response=await call(env,path);assert.equal(response.status,200);assert.equal((await response.text()).length,bytes);
  bytes=12000001;const large=await call(env,path);assert.equal(large.status,413);
 }finally{globalThis.fetch=original;db.close();}
});

test('imported Podcasts are shared by logged-in users, deduplicated and refreshed',async()=>{
 const {db,env}=setup();for(const id of ['alice','bob']){db.prepare('INSERT INTO users VALUES(?,?)').run(id,id+'@example.com');db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(await hash(id),id,Date.now()+60000);}
 const data={id:'local-id',feed:'https://feeds.example.com/show.xml',title:'Shared Show',episodes:[{id:'episode-1',title:'First',published_at:'2026-10-05T10:00:00Z',url:'https://example.com/first',audio_url:'https://example.com/first.mp3'}]};
 try{
  assert.equal((await call(env,'/podcasts/channels')).status,401);
  const a=await (await call(env,'/podcasts/channels','alice',data)).json();assert.match(a.channel.id,/^shared-/);
  const b=await (await call(env,'/podcasts/channels','bob',data)).json();assert.equal(a.channel.id,b.channel.id);
  const listing=await (await call(env,'/podcasts/channels','bob')).json();assert.equal(listing.channels.length,1);assert.equal(listing.channels[0].title,'Shared Show');assert.equal(listing.channels[0].created_by,undefined);
  const path='/podcasts/episodes?id='+a.channel.id;assert.equal((await call(env,path)).status,401);assert.equal((await (await call(env,path,'bob')).json()).episodes[0].title,'First');
  assert.equal((await call(env,path,'bob',{...data,episodes:[{...data.episodes[0],title:'Updated'}]})).status,200);
  assert.equal((await (await call(env,path,'alice')).json()).episodes[0].title,'Updated');
  assert.equal((await call(env,'/admin/podcasts/channels','alice')).status,403);
  assert.equal((await call(env,'/admin/podcasts/update','secret',{id:a.channel.id,error:'RSS unavailable'})).status,200);
  const retained=await (await call(env,path,'bob')).json();assert.equal(retained.episodes[0].title,'Updated');assert.equal(retained.error,'RSS unavailable');
  assert.equal((await call(env,'/podcasts/channels','alice',{...data,feed:'https://127.0.0.1/feed'})).status,400);
 }finally{db.close();}
});

test('untracked ranking stock gets missing OHLCV and manual refresh fetches again',async()=>{
 const {db,env}=setup();db.exec("INSERT INTO companies(code,name,full_name,market) VALUES('8150','南茂','南茂科技','上市');INSERT INTO users VALUES('alice','a@example.com');");
 db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(await hash('alice'),'alice',Date.now()+60000);
 const original=globalThis.fetch;let requests=0;
 globalThis.fetch=async()=>{requests++;return Response.json({chart:{result:[{meta:{symbol:'8150.TW'},timestamp:[Math.floor(Date.now()/1000)],indicators:{quote:[{open:[10],high:[12],low:[9],close:[11],volume:[2000]}]}}]}});};
 try{
  assert.equal((await call(env,'/chart-prices?code=8150')).status,401);assert.equal(requests,0);
  const first=await (await call(env,'/chart-prices?code=8150','alice')).json();assert.equal(first.prices[0].open,10);assert.equal(first.refreshed,true);assert.equal(requests,1);
  await call(env,'/chart-prices?code=8150','alice');assert.equal(requests,1);
  await call(env,'/chart-prices?code=8150','alice',{});assert.equal(requests,2);
  globalThis.fetch=async()=>{throw Error('offline');};
  const fallback=await (await call(env,'/chart-prices?code=8150','alice',{})).json();assert.equal(fallback.prices.length,1);assert.equal(fallback.refreshed,false);assert.ok(fallback.warning);
 }finally{globalThis.fetch=original;db.close();}
});

test('chart history keeps two years and collector reports populated months',async()=>{
 const {db,env}=setup();db.exec("INSERT INTO companies(code,name,full_name,market) VALUES('8150','南茂','南茂科技','上市');INSERT INTO users VALUES('alice','a@example.com');INSERT INTO watchlists VALUES('alice','8150','now');");
 db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(await hash('alice'),'alice',Date.now()+60000);
 const dates=[1,2,3,4,5,6,7,8,9,10].map(i=>new Date(Date.now()-(690+i)*86400000).toISOString().slice(0,10));
 const rows=dates.map(date=>({code:'8150',date,open:10,high:12,low:9,close:11,volume:100}));
 await call(env,'/admin/prices','secret',{prices:rows});const chart=await (await call(env,'/chart-prices?code=8150','alice')).json();assert.equal(chart.prices.length,10);
 const catalog=await (await call(env,'/admin/chart-codes','secret')).json();assert.equal(catalog.companies[0].code,'8150');assert.ok('price_months' in catalog.companies[0]);db.close();
});

const profileHTML='<h1>8150 南茂 10/05 收盤價：124元</h1><table><tr><th>近 4 季EPS (元)</th><td><a>3.21</a></td></tr><tr><th>8 月營收YOY (%)</th><td>33.27</td></tr><tr><th>近 4 季ROE (%)</th><td>—</td></tr><tr><th>其他個股推薦</th><td>999</td></tr></table><h3>公司簡介</h3><div class="m-0"><span>提供記憶體封裝與測試服務。</span></div><h3>其他內容</h3>';
test('public company profile extracts only disclosed metrics, keeps periods and verifies company',()=>{const p=parseCompanyProfile(profileHTML,'8150');assert.equal(p.introduction,'提供記憶體封裝與測試服務。');assert.equal(p.metrics.length,2);assert.equal(p.metrics[0].label,'近 4 季EPS (元)');assert.equal(p.metrics[1].label,'8 月營收YOY (%)');assert.throws(()=>parseCompanyProfile(profileHTML,'2330'),/代號不符/);});
test('company profile requires login and caches public facts across users',async()=>{const {db,env}=setup();db.exec("INSERT INTO companies(code,name,full_name,market) VALUES('8150','南茂','南茂科技','上市');INSERT INTO users VALUES('alice','a@example.com');INSERT INTO users VALUES('bob','b@example.com');");for(const id of ['alice','bob'])db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(await hash(id),id,Date.now()+60000);const originalFetch=globalThis.fetch,originalCaches=globalThis.caches;const saved=new Map();let requests=0;globalThis.caches={default:{match:async key=>saved.get(key.url)?.clone(),put:async(key,response)=>saved.set(key.url,response.clone())}};globalThis.fetch=async()=>{requests++;return new Response(profileHTML);};try{assert.equal((await call(env,'/company-profile?code=8150')).status,401);assert.equal(requests,0);const first=await (await call(env,'/company-profile?code=8150','alice')).json();assert.equal(first.profile.code,'8150');await call(env,'/company-profile?code=8150','bob');assert.equal(requests,1);await call(env,'/company-profile?code=8150','alice',{});assert.equal(requests,2);}finally{globalThis.fetch=originalFetch;globalThis.caches=originalCaches;db.close();}});
test('ranking exposes latest market-cap reference even for a historical selected date',async()=>{const {db,env}=setup();db.exec("INSERT INTO users VALUES('alice','a@example.com');");db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(await hash('alice'),'alice',Date.now()+60000);const stock={code:'2327',name:'國巨',market:'上市',tag:'電子零組件',amount:100};await call(env,'/admin/ranking','secret',{date:'2026-10-02',stocks:[stock]});await call(env,'/admin/ranking','secret',{date:'2026-10-05',stocks:[{...stock,marketCap:8000}]});const data=await (await call(env,'/ranking?date=2026-10-02','alice')).json();assert.equal(data.date,'2026-10-02');assert.equal(data.marketCaps.date,'2026-10-05');assert.equal(data.marketCaps.stocks[0].value,8000);db.close();});
test('company profile distinguishes unavailable pages from wrong stock and tolerates header variants',()=>{
 assert.throws(()=>parseCompanyProfile('<title>Just a moment...</title><h1>驗證中</h1>','3026'),/暫未回傳/);
 const facts='<table><tr><td>本益比 (倍)</td><td>20</td></tr></table>';
 assert.equal(parseCompanyProfile('<h1>網站導覽</h1><h1 class="[&>b]:block">3026 禾伸堂</h1>'+facts,'3026').code,'3026');
 assert.equal(parseCompanyProfile('<title>3026禾伸堂股票 | 財報狗</title>'+facts,'3026').code,'3026');
 assert.throws(()=>parseCompanyProfile('<title>3026禾伸堂股票</title><h1>2330 台積電</h1>'+facts,'3026'),/代號不符/);
 assert.throws(()=>parseCompanyProfile('<h1>13026 其他公司</h1>'+facts,'3026'),/暫未回傳/);
});
test('failed edge profile fetch queues a validated background collection and shares persisted result',async()=>{
 const {db,env}=setup();env.GITHUB_DISPATCH_TOKEN='test-token';
 db.exec("INSERT INTO companies(code,name,full_name,market) VALUES('8150','南茂','南茂科技','上市');INSERT INTO users VALUES('alice','a@example.com');");
 db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(await hash('alice'),'alice',Date.now()+60000);
 const originalFetch=globalThis.fetch,originalCaches=globalThis.caches;let edge=0,dispatches=0;
 globalThis.caches=undefined;globalThis.fetch=async url=>{if(String(url).includes('api.github.com')){assert.ok(String(url).includes('company-profiles.yml/dispatches'));dispatches++;return new Response(null,{status:204});}edge++;return new Response('<title>Verification</title>');};
 try{
  assert.equal((await (await call(env,'/company-profile?code=8150','alice')).json()).pending,true);
  assert.equal((await (await call(env,'/company-profile?code=8150','alice')).json()).pending,true);
  assert.equal(edge,1);assert.equal(dispatches,1);
  assert.equal((await call(env,'/admin/company-profiles','wrong',{code:'8150',html:profileHTML})).status,403);
  assert.equal((await call(env,'/admin/company-profiles','secret',{code:'8150',html:profileHTML.replace('8150','2330')})).status,500);
  assert.equal((await call(env,'/admin/company-profiles','secret',{code:'8150',html:profileHTML})).status,200);
  const ready=await (await call(env,'/company-profile?code=8150','alice')).json();assert.equal(ready.profile.code,'8150');assert.equal(ready.pending,undefined);assert.equal(edge,1);
 }finally{globalThis.fetch=originalFetch;globalThis.caches=originalCaches;db.close();}
});
test('official fallback is identity checked and carries its actual source into shared responses',async()=>{
 const {db,env}=setup();db.exec("INSERT INTO companies(code,name,full_name,market) VALUES('2330','台積電','台灣積體電路製造股份有限公司','上市');INSERT INTO users VALUES('alice','a@example.com');");db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(await hash('alice'),'alice',Date.now()+60000);
 const official={name:'台積電',full_name:'台灣積體電路製造股份有限公司',introduction:'積體電路製造',metrics:[{label:'實收資本額（元）',value:'259000000000'}]};
 assert.equal((await call(env,'/admin/company-profiles','secret',{code:'2330',official:{...official,name:'錯誤',full_name:'錯誤'}})).status,400);
 assert.equal((await call(env,'/admin/company-profiles','secret',{code:'2330',official})).status,200);
 const result=await (await call(env,'/company-profile?code=2330','alice')).json();assert.equal(result.profile.source,'臺灣證券交易所');assert.match(result.warning,/交易所/);assert.equal(result.profile.metrics[0].label,'實收資本額（元）');db.close();
});

test('account result sync isolates users, rejects credentials and protects newer versions',async()=>{
 const {db,env}=setup();for(const id of ['alice','bob']){db.prepare('INSERT INTO users VALUES(?,?)').run(id,id+'@example.com');db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(await hash(id),id,Date.now()+60000);}
 const row={id:'analysis',title:'台積電',kind:'text',date:'2026-10-06',updated_at:'2026-10-06T12:00:00.000Z',answer:'量價分析',text:'',partial:false,failures:[]};
 assert.equal((await call(env,'/account-results',null,row)).status,401);
 assert.equal((await call(env,'/account-results','alice',{...row,key:'secret'})).status,400);
 assert.equal((await call(env,'/account-results','alice',row)).status,200);
 assert.equal((await (await call(env,'/account-results','bob')).json()).results.length,0);
 await call(env,'/account-results','alice',{...row,updated_at:'2026-10-05T12:00:00.000Z',answer:'old'});
 assert.equal((await (await call(env,'/account-results','alice')).json()).results[0].answer,'量價分析');
 await call(env,'/account-results?id=analysis','bob',undefined,'DELETE');
 assert.equal((await (await call(env,'/account-results','alice')).json()).results.length,1);
 await call(env,'/account-results?id=analysis','alice',undefined,'DELETE');
 assert.equal((await (await call(env,'/account-results','alice')).json()).results.length,0);db.close();
});

test('device news sync isolates accounts and accepts only public news fields',async()=>{
 const {db,env}=setup();for(const id of ['alice','bob']){db.prepare('INSERT INTO users VALUES(?,?)').run(id,id+'@example.com');db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(await hash(id),id,Date.now()+60000);}
 const row={company_code:'2330',title:'新聞',url:'https://example.com/news',source:'中央社',published_at:'2026-10-06T12:00:00Z',news_date:'2026-10-06'};
 assert.equal((await call(env,'/account-news','alice',[{...row,key:'secret'}])).status,400);
 assert.equal((await call(env,'/account-news','alice',[row])).status,200);
 assert.equal((await (await call(env,'/account-news','alice')).json()).news.length,1);
 assert.equal((await (await call(env,'/account-news','bob')).json()).news.length,0);db.close();
});


test('public transcript proxy serves text with CORS and rejects private redirects',async()=>{const {db,env}=setup(),original=globalThis.fetch;try{globalThis.fetch=async()=>new Response('台積電逐字稿',{headers:{'Content-Type':'text/plain; charset=utf-8'}});const path='/podcasts/transcript?url='+encodeURIComponent('https://example.com/episode.vtt');const response=await call(env,path);assert.equal(response.status,200);assert.match(await response.text(),/台積電/);globalThis.fetch=async()=>new Response(null,{status:302,headers:{Location:'https://127.0.0.1/private'}});const blocked=await call(env,path);assert.equal(blocked.status,502);}finally{globalThis.fetch=original;db.close();}});

test('daily D1 quota failure returns a recoverable 503 with reset time',async()=>{const env={APP_URL:'https://example.com/',DB:{prepare(){throw Error("D1_ERROR: Your account has exceeded D1's free tier daily row read limit.");}}};const r=await call(env,'/me','alice');assert.equal(r.status,503);assert.equal((await r.json()).code,'D1_READ_QUOTA');assert.ok(Number(r.headers.get('Retry-After'))>0);});

test('unchanged account news sync does not rewrite rows and task queries use their user index',async()=>{const {db,env}=setup();db.prepare('INSERT INTO users VALUES(?,?)').run('alice','a@example.com');db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(await hash('alice'),'alice',Date.now()+60000);try{const rows=[{company_code:'2330',title:'新聞',url:'https://example.com/story',source:'中央社',published_at:'2026-10-06T00:00:00Z',news_date:'2026-10-06'}];assert.equal((await call(env,'/account-news','alice',rows)).status,200);const before=db.prepare('SELECT total_changes() AS n').get().n;assert.equal((await call(env,'/account-news','alice',rows)).status,200);assert.equal(db.prepare('SELECT total_changes() AS n').get().n,before);assert.equal((await call(env,'/ai-jobs','alice')).status,200);const plan=db.prepare('EXPLAIN QUERY PLAN SELECT * FROM personal_ai_tasks WHERE user_id=? ORDER BY updated_at DESC LIMIT 100').all('alice');assert.ok(plan.some(r=>r.detail.includes('personal_ai_user_updated')));}finally{db.close();}});

test('company search supports partial stock codes and ranks closest matches first',async()=>{
 const {db,env}=setup();
 db.prepare('INSERT INTO users VALUES(?,?)').run('alice','alice@example.com');
 db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(await hash('alice'),'alice',Date.now()+60000);
 db.prepare('INSERT INTO companies(code,name,full_name,market) VALUES(?,?,?,?)').run('1232','甲公司','甲公司股份有限公司','上市');
 db.prepare('INSERT INTO companies(code,name,full_name,market) VALUES(?,?,?,?)').run('2327','國巨','國巨股份有限公司','上市');
 db.prepare('INSERT INTO companies(code,name,full_name,market) VALUES(?,?,?,?)').run('3232','乙公司','乙公司股份有限公司','上市');
 const byCode=await (await call(env,'/companies?q=232','alice')).json();
 assert.deepEqual(byCode.companies.map(c=>c.code),['2327','1232','3232']);
 const byName=await (await call(env,'/companies?q=國巨','alice')).json();
 assert.deepEqual(byName.companies.map(c=>c.code),['2327']);
 const empty=await (await call(env,'/companies?q=','alice')).json();
 assert.deepEqual(empty.companies,[]);
});
