import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {detectMovement,newsWindow,completedDay,eventPrompt} from '../shared/stock-movements.js';
import {stockEventsRoute} from '../worker/stock-events.js';
import {stockEventCacheRoute} from '../worker/stock-event-cache.js';
import {parsePreview,curateNews,companyMention} from '../worker/index.js';
const dates=['2026-09-28','2026-09-29','2026-09-30','2026-10-01','2026-10-02','2026-10-05'];
const bars=closes=>closes.map((close,i)=>({code:'2330',date:dates[i],close,volume:100}));
const index=dates.map(date=>({code:'TAIEX',date,close:100}));
const makeDB=()=>{const db=new DatabaseSync(':memory:');return {db,sql:(q,...args)=>{const stmt=db.prepare(q);return {first:async()=>stmt.get(...args)||null,all:async()=>({results:stmt.all(...args)}),run:async()=>stmt.run(...args)};}};};
const reply=(data,status=200)=>Response.json(data,{status});
test('movement uses preceding close, handles both directions and clips future data',()=>{
 const rising=detectMovement([...bars([100,101,102,103,107,114]),...index],{code:'2330',date:dates[5]});
 assert.equal(rising.triggered,true);assert.equal(rising.windows[0].baseline,dates[2]);assert.equal(rising.windows[0].from,dates[3]);assert.ok(Math.abs(rising.windows[0].change-(114/102-1)*100)<1e-9);
 assert.equal(rising.from,dates[1]);assert.deepEqual(newsWindow(rising,45),{from:'2026-08-15',to:'2026-10-05'});
 const falling=detectMovement([...bars([100,99,98,97,92,86]),...index],{code:'2330',date:dates[5]});assert.equal(falling.triggered,true);assert.ok(falling.windows[1].change<0);
 assert.equal(detectMovement(bars([100,101,102,103,107,114]),{code:'2330',date:dates[2]}).triggered,false);
});
test('missing benchmark sessions and invalid prices do not form a valid return window',()=>{
 const missing=detectMovement([...bars([100,101,102,103,107,114]).filter(p=>p.date!==dates[3]),...index],{code:'2330',date:dates[5]});assert.equal(missing.triggered,false);
 const zero=detectMovement([...bars([100,101,102,103,107,0]),...index],{code:'2330',date:dates[5]});assert.equal(zero.triggered,false);
 assert.equal(completedDay(new Date('2026-10-08T01:30:00Z')),'2026-10-07');
 assert.equal(completedDay(new Date('2026-10-08T06:00:00Z')),'2026-10-08');
});
test('45-day retrieval includes older news but excludes future and unrelated stories',async()=>{
 const {db,sql}=makeDB();db.exec('CREATE TABLE companies(code TEXT,name TEXT,full_name TEXT); CREATE TABLE prices(code TEXT,date TEXT,close REAL,volume REAL); CREATE TABLE news(company_code TEXT,news_date TEXT,published_at TEXT,title TEXT,url TEXT,source TEXT);');db.prepare('INSERT INTO companies VALUES(?,?,?)').run('2330','台積電','台灣積體電路');
 for(const p of [...bars([100,101,102,103,107,114]),...index])db.prepare('INSERT INTO prices VALUES(?,?,?,?)').run(p.code,p.date,p.close,p.volume||100);
 const urls=[],item=(title,day,id)=>`<item><title>${title}</title><link>https://www.cna.com.tw/${id}</link><pubDate>${day}T02:00:00Z</pubDate><source url="https://www.cna.com.tw">中央社</source></item>`;
 const fetcher=async url=>{urls.push(url.href);return new Response('<rss><channel>'+item('台積電訂單確認','2026-08-20',1)+item('台積電未來事件','2026-10-06',2)+item('聯電事件','2026-08-20',3)+'</channel></rss>');};
 const result=await stockEventsRoute(new Request('https://api.test/stock-event-news?code=2330&date=2026-10-05&lookback=45'),{sql,reply,user:{id:'alice'},parsePreview,curateNews,companyMention,fetcher});
 assert.equal(result.status,200);const data=await result.json();assert.equal(data.owner_id,'alice');assert.equal(data.news.length,1);assert.equal(data.news[0].news_date,'2026-08-20');assert.equal(data.coverage.from,'2026-08-15');assert.equal(data.coverage.complete,false);assert.ok(urls.every(url=>!url.includes('when%3A1m')));assert.ok(urls.length>=7);
 const noAuth=await stockEventsRoute(new Request('https://api.test/stock-movements?codes=2330'),{sql,reply});assert.equal(noAuth.status,401);
 db.close();
});
test('cache locks and answers are isolated by authenticated user, not body identity',async()=>{
 const {db,sql}=makeDB();let n=0;const call=async(user,body)=>stockEventCacheRoute(new Request('https://api.test/stock-event-cache',{method:'POST',body:JSON.stringify(body)}),{sql,reply,user:{id:user},randomToken:()=>String(++n)});
 const key='a'.repeat(64),alice=await (await call('alice',{key,action:'claim',user_id:'bob'})).json();assert.ok(alice.lease);
 const busy=await (await call('alice',{key,action:'claim'})).json();assert.equal(busy.busy,true);
 const bob=await (await call('bob',{key,action:'claim'})).json();assert.ok(bob.lease);assert.notEqual(bob.lease,alice.lease);
 assert.equal((await call('bob',{key,action:'save',lease:alice.lease,answer:'stolen'})).status,409);
 assert.equal((await call('alice',{key,action:'save',lease:alice.lease,answer:'private paid answer'})).status,200);
 assert.equal((await (await call('bob',{key,action:'read'})).json()).answer,'');
 assert.equal((await (await call('alice',{key,action:'read'})).json()).answer,'private paid answer');
 db.close();
});
test('event prompt separates evidence, old events, later reports and unknown cause',()=>{
 const prompt=eventPrompt({code:'2330',name:'台積電'},{date:'2026-10-05'},[{news_date:'2026-09-01',title:'訂單',url:'https://www.cna.com.tw/story',source:'中央社'}],{complete:false});
 assert.match(prompt,/目前證據不足/);assert.match(prompt,/不可倒推/);assert.match(prompt,/僅標題/);assert.match(prompt,/\[1\]/);
});

test('capped event evidence retains oldest and newest full-text candidates', async()=>{
 const {eventEvidence,eventFullTextCandidates}=await import('../shared/stock-movements.js');
 const news=Array.from({length:130},(_,i)=>({url:'https://example.test/'+i}));
 const evidence=eventEvidence(news);
 assert.equal(evidence.length,100);
 for(const row of eventFullTextCandidates(news))assert.ok(evidence.includes(row));
 assert.equal(evidence[0],news[0]);assert.equal(evidence.at(-1),news.at(-1));
});

test('large watchlists load every code in bounded authenticated batches',async()=>{
 const {loadMovementOverview}=await import('../shared/stock-movements.js');
 const codes=Array.from({length:211},(_,i)=>String(1000+i)),sizes=[];
 const result=await loadMovementOverview({codes,date:'2026-10-05',owner:'alice'},async path=>{
  const batch=new URL('https://api.test'+path).searchParams.get('codes').split(',');sizes.push(batch.length);
  return {owner_id:'alice',movements:batch.map(code=>({code}))};
 });
 assert.deepEqual(sizes,[90,90,31]);assert.deepEqual(result.movements.map(r=>r.code),codes);
 await assert.rejects(()=>loadMovementOverview({codes,date:'2026-10-05',owner:'alice'},async()=>({owner_id:'bob',movements:[]})),/登入身分/);
});
test('movement routes support catalog codes and stay under D1 parameter limits',async()=>{
 const requests=[],sql=(q,...args)=>{requests.push(args);return {all:async()=>({results:[]}),first:async()=>({code:args[0],name:'測試'})};};
 const codes=[...Array.from({length:98},(_,i)=>String(1000+i)),'00500','123456'];
 const overview=await stockEventsRoute(new Request('https://api.test/stock-movements?date=2026-10-05&codes='+codes.join(',')),{sql,reply,user:{id:'alice'}});
 assert.equal(overview.status,200);assert.equal((await overview.json()).movements.length,100);assert.ok(requests.every(args=>args.length<100));
 for(const code of ['00500','123456']){
  const result=await stockEventsRoute(new Request('https://api.test/stock-event-news?date=2026-10-05&code='+code),{sql,reply,user:{id:'alice'}});
  assert.equal(result.status,422); // Valid code, but no stored prices.
 }
});
test('long event articles reserve real text for both oldest and newest evidence',async()=>{
 const {eventEvidenceWithText,eventFullTextCandidates}=await import('../shared/stock-movements.js');
 const news=Array.from({length:130},(_,i)=>({url:'https://example.test/'+i}));
 const articles=eventFullTextCandidates(news).map(r=>({...r,text:'內容'.repeat(5000)}));
 const evidence=eventEvidenceWithText(news,articles),selected=evidence.filter(r=>r.text);
 assert.equal(selected.length,12);assert.ok(evidence.at(-1).text.startsWith('內容'));assert.ok(selected.every(r=>r.text.includes('內文節錄')));
 assert.ok(selected.reduce((sum,r)=>sum+r.text.split('\n')[0].length,0)<=44000);
});
