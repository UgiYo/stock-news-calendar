import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {marketDay,completedMarketDay,isUS,usCompanies,marketCompanies,usMention} from '../shared/markets.js';
import {detectMovement,eventPrompt} from '../shared/stock-movements.js';
import {usDailyBars,usMarketRoute,saveUSPrices,fetchUSFilings} from '../worker/us-market.js';
import {parsePreview,curateNews,companyMention} from '../worker/index.js';
import {stockEventsRoute} from '../worker/stock-events.js';
import {findAssistantCompany,assistantSources} from '../src/assistant-sources.js';
import {podcastMentions} from '../src/podcast-mentions.js';
import {candlePanel} from '../src/candles.js';
function fixture(){
 const db=new DatabaseSync(':memory:');db.exec(readFileSync(new URL('../worker/migrations/0001_init.sql',import.meta.url),'utf8'));
 const sql=(q,...args)=>{const s=db.prepare(q);return {first:async()=>s.get(...args)||null,all:async()=>({results:s.all(...args)}),run:async()=>s.run(...args)};};
 return {db,sql,env:{DB:{batch:async rows=>Promise.all(rows.map(r=>r.run()))}},reply:(data,status=200)=>Response.json(data,{status}),user:{id:'alice'},parsePreview};
}
const nvda=usCompanies.find(c=>c.code==='US:NVDA');
const catalog=()=>Response.json({fields:['cik','name','ticker','exchange'],data:[[1045810,'NVIDIA CORP','NVDA','Nasdaq'],[320193,'APPLE INC','AAPL','Nasdaq'],[1,'EXAMPLE CORPORATION','EXM','NYSE'],[2,'OTC sample','OTCX',null]]});
test('market namespaces and dates separate ADRs, DST and core close cutoffs',()=>{
 assert.equal(isUS('US:BRK.B'),true);assert.equal(isUS('US:../NVDA'),false);
 assert.equal(marketDay(new Date('2026-10-09T01:00:00Z'),'US'),'2026-10-08');
 assert.equal(marketDay(new Date('2026-10-09T01:00:00Z'),'TW'),'2026-10-09');
 assert.equal(completedMarketDay(new Date('2026-07-09T19:59:00Z'),'US'),'2026-07-08');
 assert.equal(completedMarketDay(new Date('2026-07-09T20:01:00Z'),'US'),'2026-07-09');
 assert.equal(completedMarketDay(new Date('2026-12-09T20:01:00Z'),'US'),'2026-12-08');
 assert.equal(completedMarketDay(new Date('2026-12-09T21:01:00Z'),'US'),'2026-12-09');
 assert.equal(completedMarketDay(new Date('2026-10-12T04:00:00Z'),'US'),'2026-10-09');
 assert.deepEqual(marketCompanies([{code:'2330'},{code:'US:TSM'}],'TW'),[{code:'2330'}]);
});
test('company aliases and ticker boundaries avoid ordinary English word matches',()=>{
 assert.equal(usMention('輝達新產品',nvda),true);assert.equal(usMention('NVIDIA earnings',nvda),true);
 assert.equal(usMention('NVDA guidance',nvda),true);assert.equal(usMention('XNVDA holdings',nvda),false);
 const arm=usCompanies.find(c=>c.symbol==='ARM');assert.equal(usMention('arm injury',arm),false);assert.equal(usMention('$ARM results',arm),true);
 assert.equal(usMention('AMD earnings',usCompanies.find(c=>c.symbol==='AMD')),true);
 assert.equal(findAssistantCompany('NVIDIA 近況',[nvda])[0].code,'US:NVDA');
 const mentions=podcastMentions({kind:'podcast',text:'輝達與 NVIDIA 新產品',answer:'',state:'pending'},[nvda]);assert.equal(mentions[0].code,'US:NVDA');
});
test('English news survives curation only for US and groups by Eastern publication date',()=>{
 const xml='<rss><channel><item><title>NVIDIA earnings update</title><link>https://www.reuters.com/technology/nvidia</link><pubDate>Fri, 09 Oct 2026 01:00:00 GMT</pubDate><source url="https://www.reuters.com">Reuters</source></item></channel></rss>';
 const rows=parsePreview(xml,nvda,new Date('2026-10-10T00:00:00Z'));assert.equal(rows.length,1);assert.equal(rows[0].news_date,'2026-10-08');
 assert.equal(curateNews([{...rows[0],company_code:'2330'}]).length,0);
 assert.equal(companyMention(rows[0].title,nvda),true);
 const same=[rows[0],{...rows[0],company_code:'US:TSM'}];assert.equal(curateNews(same).length,2);
 assert.match(assistantSources('輝達',{companies:[nvda],news:rows})[0].text,/美東日期/);
});
test('US bars exclude an unfinished session and preserve raw and adjusted prices',()=>{
 const result={timestamp:[Date.parse('2026-10-08T13:30Z')/1000,Date.parse('2026-10-09T13:30Z')/1000],indicators:{quote:[{open:[100,101],high:[102,103],low:[99,100],close:[101,102],volume:[10,20]}],adjclose:[{adjclose:[50.5,51]}]}};
 const rows=usDailyBars(result,'US:NVDA',new Date('2026-10-09T18:00Z'));assert.equal(rows.length,1);assert.equal(rows[0].date,'2026-10-08');assert.equal(rows[0].close,101);assert.equal(rows[0].adjusted_close,50.5);
});
test('adjusted returns do not flag a split as an event or borrow Taiwan benchmark',()=>{
 const dates=['2026-10-01','2026-10-02','2026-10-05','2026-10-06','2026-10-07','2026-10-08'];
 const rows=dates.map((date,i)=>({code:'US:NVDA',date,close:i<3?1000:100,adjusted_close:100,volume:10}));
 const m=detectMovement([...rows,...dates.map(date=>({code:'TAIEX',date,close:1}))],{code:'US:NVDA',date:dates.at(-1)});
 assert.equal(m.triggered,false);assert.equal(m.adjusted,true);assert.equal(m.windows[0].change,0);assert.equal(m.windows[0].marketChange,null);
 assert.match(eventPrompt(nvda,m,[],{}),/美股，價格為美元/);assert.match(eventPrompt(nvda,m,[],{}),/metadata/);
});
test('US search stores canonical records, preview works, saved prices survive provider failure',async()=>{
 const f=fixture();try{
  const found=await (await usMarketRoute(new Request('https://api.test/companies?market=US&q=輝達'),f.env,{...f,fetcher:async()=>catalog()})).json();assert.equal(found.companies[0].code,'US:NVDA');assert.equal(f.db.prepare('SELECT market FROM companies WHERE code=?').get('US:NVDA').market,'美股');
  const symbol=await (await usMarketRoute(new Request('https://api.test/companies?market=US&q=EXM'),f.env,{...f,fetcher:async()=>catalog()})).json();assert.equal(symbol.companies[0].code,'US:EXM');
  const anon=await usMarketRoute(new Request('https://api.test/chart-prices?code=US:NVDA'),f.env,{...f,user:null});assert.equal(anon.status,401);
  assert.equal((await usMarketRoute(new Request('https://api.test/prices?code=US:NVDA'),f.env,f)).status,403);
  await saveUSPrices(f.sql,f.env.DB,[{code:'US:NVDA',date:'2026-10-08',open:100,high:101,low:99,close:100,volume:10,adjusted_close:100}]);
  const failed=await usMarketRoute(new Request('https://api.test/chart-prices?code=US:NVDA',{method:'POST'}),f.env,{...f,fetcher:async()=>new Response('',{status:503})});assert.equal(failed.status,200);const data=await failed.json();assert.equal(data.prices.length,1);assert.match(data.warning,/暫時無法取得/);assert.equal(data.currency,'USD');
 }finally{f.db.close();}
});
test('US news preview can use the official Pocket index when Google News fails',async()=>{
 const f=fixture();try{
  f.db.prepare('INSERT INTO companies(code,name,full_name,market) VALUES(?,?,?,?)').run('US:NVDA','輝達','NVIDIA','美股');
  const date=marketDay(new Date(),'TW');const fetcher=async value=>{const u=new URL(value);if(u.hostname==='news.google.com')throw Error('RSS unavailable');return Response.json({code:'0',pages:1,data:[{Title:'輝達（NVDA）財報重點',date,slug:'/school/report/SB/9001/'}]});};
  const response=await usMarketRoute(new Request('https://api.test/preview?code=US:NVDA'),f.env,{...f,fetcher});assert.equal(response.status,200);const data=await response.json();assert.equal(data.news.length,1);assert.equal(data.news[0].company_code,'US:NVDA');assert.equal(data.news[0].source,'口袋證券');assert.match(data.warnings[0],/Google News/);assert.equal(data.news[0].published_at,date);
 }finally{f.db.close();}
});
test('SEC filings verify CIK, retain exact document URLs and distinguish metadata',async()=>{
 const fetcher=async()=>Response.json({cik:'1045810',filings:{recent:{accessionNumber:['0001045810-26-000001'],form:['10-Q'],filingDate:['2026-10-08'],acceptanceDateTime:['2026-10-08T20:00:00Z'],primaryDocument:['nvda-20261008.htm']}}});
 const rows=await fetchUSFilings({...nvda,cik:'0001045810'},{},fetcher);assert.equal(rows.length,1);assert.match(rows[0].url,/1045810\/000104581026000001\/nvda-20261008.htm/);assert.equal(rows[0].evidence_kind,'filing_metadata');
 await assert.rejects(fetchUSFilings({...nvda,cik:'0000000001'},{},fetcher),/識別不符/);
});
test('US event route rejects mixed markets and searches both English news and SEC filings',async()=>{
 const f=fixture();try{
  f.db.prepare('INSERT INTO companies(code,name,full_name,market) VALUES(?,?,?,?)').run(nvda.code,nvda.name,nvda.full_name,'美股');
  const dates=['2026-10-01','2026-10-02','2026-10-05','2026-10-06','2026-10-07','2026-10-08'];
  await saveUSPrices(f.sql,f.env.DB,dates.map((date,i)=>({code:nvda.code,date,open:100,high:115,low:99,close:100+i*3,volume:10,adjusted_close:100+i*3})));
  const mixed=await stockEventsRoute(new Request('https://api.test/stock-movements?codes=US:NVDA,2330&date=2026-10-08'),{...f,curateNews,companyMention});assert.equal(mixed.status,400);
  const seen=[],fetcher=async url=>{seen.push(String(url));if(String(url).includes('data.sec.gov'))return Response.json({cik:'1045810',filings:{recent:{accessionNumber:['0001045810-26-000001'],form:['8-K'],filingDate:['2026-10-08'],acceptanceDateTime:['2026-10-08T20:00:00Z'],primaryDocument:['doc.htm']}}});return new Response('<rss><channel><item><title>NVIDIA new product</title><link>https://www.cnbc.com/nvidia</link><pubDate>Wed, 30 Sep 2026 18:00:00 GMT</pubDate><source url="https://www.cnbc.com">CNBC</source></item></channel></rss>');};
  const response=await stockEventsRoute(new Request('https://api.test/stock-event-news?code=US:NVDA&date=2026-10-08'),{...f,curateNews,companyMention,fetcher});assert.equal(response.status,200);const data=await response.json();assert.equal(data.movement.adjusted,true);assert.equal(data.coverage.timezone,'America/New_York');assert.ok(data.news.some(n=>n.source==='CNBC'));assert.ok(data.news.some(n=>n.source==='SEC EDGAR'));assert.ok(seen.some(u=>u.includes('hl=en-US')));
 }finally{f.db.close();}
});
test('US candle controls offer daily/weekly/monthly with USD and share units',()=>{
 const html=candlePanel({code:'US:NVDA',prices:[{code:'US:NVDA',date:'2026-10-08',open:100,high:102,low:99,close:101,volume:1500}]});
 assert.match(html,/USD 美元/);assert.match(html,/data-candle-period="week"/);assert.doesNotMatch(html,/data-candle-period="1m"/);assert.doesNotMatch(html,/1.5 張/);assert.match(html,/原始 K · 來源行情/);assert.match(html,/id="toggle-adjusted-candles"/);
});

test('authenticated API isolates US news and accepts same-account cross-device news sync',async()=>{
 const {default:worker,hash}=await import('../worker/index.js');const f=fixture();
 f.env.APP_URL='https://app.test';f.env.DB.prepare=q=>({bind:(...args)=>f.sql(q,...args)});
 const call=(path,who,body)=>worker.fetch(new Request('https://api.test'+path,{method:body?'POST':'GET',headers:who?{Authorization:'Bearer '+who}:{},body:body?JSON.stringify(body):undefined}),f.env);
 try{
  for(const who of ['alice','bob']){f.db.prepare('INSERT INTO users VALUES(?,?)').run(who,who+'@test.example');f.db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(await hash(who),who,Date.now()+60000);}
  f.db.prepare('INSERT INTO companies(code,name,full_name,market) VALUES(?,?,?,?)').run(nvda.code,nvda.name,nvda.full_name,'美股');
  assert.equal((await call('/watchlists','alice',{code:nvda.code})).status,200);
  f.db.prepare('INSERT INTO news(company_code,title,url,source,published_at,news_date) VALUES(?,?,?,?,?,?)').run(nvda.code,'NVIDIA news','https://www.reuters.com/example','Reuters','2026-10-08T18:00:00Z','2026-10-08');
  assert.equal((await (await call('/news?from=2026-10-01&to=2026-10-31','alice')).json()).news.length,1);
  assert.equal((await (await call('/news?from=2026-10-01&to=2026-10-31','bob')).json()).news.length,0);
  const company=(await (await call('/watchlists','alice')).json()).companies[0];assert.equal(company.currency,'USD');assert.ok(company.aliases.includes('輝達'));
  const preference=await call('/account-settings','alice',{sync_enabled:true});assert.equal(preference.status,200);assert.equal((await (await call('/account-settings','alice')).json()).sync_enabled,true);assert.equal((await (await call('/account-settings','bob')).json()).sync_enabled,null);
  const body=[{company_code:nvda.code,title:'Private NVIDIA news',url:'https://www.cnbc.com/private',source:'CNBC',published_at:'2026-10-08T19:00:00Z',news_date:'2026-10-08'}];
  const sync=await call('/account-news','alice',body);assert.equal(sync.status,200);
  const alice=await (await call('/account-news?from=2026-10-01&to=2026-10-31','alice')).json();assert.equal(alice.news.length,1);
  const bob=await (await call('/account-news?from=2026-10-01&to=2026-10-31','bob')).json();assert.equal(bob.news.length,0);
 }finally{f.db.close();}
});

test('US event reactions align late Eastern news to the next actual US session',async()=>{
 const {studyEvent}=await import('../src/event-study.js');
 const prices=['2026-10-07','2026-10-08','2026-10-09','2026-10-12'].map((date,i)=>({code:'US:NVDA',date,close:100+i,adjusted_close:100+i}));
 const result=studyEvent({company_code:'US:NVDA',title:'NVIDIA earnings',published_at:'2026-10-09T01:00:00Z'},prices);
 assert.equal(result.publishedDay,'2026-10-08');assert.equal(result.afterClose,true);assert.equal(result.date,'2026-10-09');assert.equal(result.baseline,'2026-10-08');assert.equal(result.adjusted,true);assert.match(result.alignment,/美東 16:00/);
});
