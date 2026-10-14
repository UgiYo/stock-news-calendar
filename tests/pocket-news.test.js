import test from 'node:test';
import assert from 'node:assert/strict';
import {pocketArticleURL,pocketArticleFields,pocketMarketMatches,pocketIndexRows,fetchPocketNews} from '../shared/pocket-news.js';
import {companyMention,curateNews,sourceDomain,trustedSource,newsSourceLabel} from '../src/news-policy.js';
import {parsePreview,extractArticleBody,normalizeArticleURL} from '../worker/index.js';
import {newsQuery} from '../shared/markets.js';
const tw={code:'2330',name:'台積電',full_name:'台灣積體電路'},adr={code:'US:TSM',name:'台積電 ADR',full_name:'Taiwan Semiconductor Manufacturing'},msft={code:'US:MSFT',name:'微軟',full_name:'Microsoft'};
const now=new Date('2026-10-14T08:00:00Z'),from=new Date('2026-09-14T08:00:00Z');
const native=(title,date='2026-10-14',slug='/school/report/SB/8001/',kind='美股教學')=>({Title:title,date,slug,kind});
test('Pocket has an exact publisher allowlist, explicit source labels, and both-market queries',()=>{
 assert.equal(sourceDomain('https://www.pocket.tw'),'口袋證券');assert.equal(sourceDomain('https://pocket.tw'),'口袋證券');assert.equal(sourceDomain('https://www.pocket.tw.evil.test'),null);
 assert.equal(trustedSource('口袋學堂'),'口袋證券');assert.equal(trustedSource('口袋證卷'),'口袋證券');assert.equal(newsSourceLabel({source:'口袋證券',company_code:'2330'}),'口袋證券 · 台股');assert.equal(newsSourceLabel({source:'口袋學堂',company_code:'US:MSFT'}),'口袋證券 · 美股');
 assert.match(newsQuery(tw),/site:pocket.tw\/school\/report/);assert.match(newsQuery(msft),/site:pocket.tw\/school\/report/);
 assert.equal(normalizeArticleURL('http://pocket.tw/school/report/SB/8001/'),'https://pocket.tw/school/report/SB/8001/');
 for(const url of ['https://www.pocket.tw/announcement/1/','https://www.pocket.tw/school/report/','https://www.pocket.tw.evil.test/school/report/SB/1/'])assert.throws(()=>pocketArticleURL(url));
});
test('same issuer Taiwan shares and ADRs remain distinct, including explicit cross-market articles',()=>{
 for(const [title,code,expected] of [
  ['台積電（2330）法說重點','2330',true],['台積電（2330）法說重點','US:TSM',false],
  ['台積電ADR（TSM）股價上漲','US:TSM',true],['台積電ADR（TSM）股價上漲','2330',false],
  ['美股台積電展望','US:TSM',true],['台積電營收創高','US:TSM',false],
  ['台積電（2330）受美股帶動','US:TSM',false],['台積電（2330）與 ADR（TSM）對照','2330',true],['台積電（2330）與 ADR（TSM）對照','US:TSM',true],
  ['台股輝達供應鏈盤點','US:NVDA',false],['台股 NVDA 供應鏈盤點','US:NVDA',true],['美股微軟財報','US:MSFT',true]
 ])assert.equal(pocketMarketMatches(title,code),expected,title+' / '+code);
 const row={source:'口袋證券',published_at:'2026-10-14',news_date:'2026-10-14',url:'https://www.pocket.tw/school/report/newflash/8002/',title:'台積電（2330）法說重點'};
 assert.deepEqual(curateNews([{...row,company_code:'2330'},{...row,company_code:'US:TSM'}]).map(r=>r.company_code),['2330']);
});
test('RSS source acceptance retains timestamp-based market dates and rejects ADR misclassification',()=>{
 const xml='<rss><channel><item><title>台積電（2330）法說重點 - 口袋學堂</title><link>https://www.pocket.tw/school/report/newflash/8002/</link><pubDate>Tue, 13 Oct 2026 18:00:00 GMT</pubDate><source url="https://www.pocket.tw">口袋學堂</source></item></channel></rss>';
 assert.equal(parsePreview(xml,tw,now)[0].news_date,'2026-10-14');assert.equal(parsePreview(xml,adr,now).length,0);
 const us=xml.replaceAll('台積電（2330）法說重點','微軟財報');assert.equal(parsePreview(us,msft,now)[0].news_date,'2026-10-13');
});
test('public native index excludes unrelated, future, stale and non-article entries, preserving date precision',()=>{
 const data={code:'0',pages:1,data:[native('微軟財報'),native('蘋果財報'),native('微軟下一季','2026-10-15'),native('微軟舊新聞','2026-08-01'),native('微軟服務公告','2026-10-14','/announcement/100/') ]};
 const rows=pocketIndexRows(data,msft,{from,now,mention:companyMention});assert.equal(rows.length,1);assert.equal(rows[0].company_code,'US:MSFT');assert.equal(rows[0].source,'口袋證券');assert.equal(rows[0].published_at,'2026-10-14');assert.equal(rows[0].news_date,'2026-10-14');assert.equal(rows[0].article_url,rows[0].url);
 assert.throws(()=>pocketIndexRows({code:'403',data:[]},msft,{from,now,mention:companyMention}));
});
test('native index paginates to the date boundary and remains usable when another keyword fails',async()=>{
 const calls=[];const result=await fetchPocketNews(msft,{from,now,mention:companyMention,fetcher:async(value,options)=>{const u=new URL(value);calls.push(u);assert.equal(options.headers.Authorization,undefined);if(u.searchParams.get('keyword')==='Microsoft')return new Response('',{status:503});return Response.json({code:'0',pages:100,data:[native('微軟財報',u.searchParams.get('page')==='1'?'2026-10-14':'2026-08-01')]});}});
 assert.equal(result.news.length,1);assert.equal(result.warnings.length,1);assert.ok(calls.every(u=>Number(u.searchParams.get('page'))<=2));assert.ok(calls.every(u=>u.hostname==='www.pocket.tw'));
});
test('encoded public article body excludes page chrome and respects nested paywall markers',()=>{
 const text='這是測試文章的公開正文，說明企業營運及市場事件。'.repeat(12),encode=s=>s.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
 const component=content=>`<nav>導航雜訊</nav><InvestNewsContent data-title="微軟財報" data-date="2026-10-14" data-news_type="美股教學" data-content='${encode(content)}'></InvestNewsContent><footer>客服雜訊</footer>`;
 const html=component('<style>樣式雜訊</style><p>'+text+'</p><script>腳本雜訊</script>');assert.equal(pocketArticleFields(html).category,'美股教學');const body=extractArticleBody(html);assert.ok(body.includes(text));assert.ok(!/導航雜訊|客服雜訊|樣式雜訊|腳本雜訊/.test(body));
 assert.throws(()=>extractArticleBody(component('<script type="application/ld+json">{"isAccessibleForFree":false}</script><p>'+text+'</p>')),/付費/);
});
test('duplicate RSS and native articles keep the original URL and exact timestamp when available',()=>{
 const base={company_code:'US:MSFT',source:'口袋證券',title:'微軟財報營收成長10%'};
 const [row]=curateNews([{...base,url:'https://news.google.com/rss/articles/a',title:base.title+' - 口袋學堂',published_at:'2026-10-13T18:00:00Z',news_date:'2026-10-13'},{...base,url:'https://www.pocket.tw/school/report/SB/8001/',article_url:'https://www.pocket.tw/school/report/SB/8001/',published_at:'2026-10-14',news_date:'2026-10-14'}]);
 assert.equal(row.article_url,'https://www.pocket.tw/school/report/SB/8001/');assert.equal(row.published_at,'2026-10-13T18:00:00Z');assert.equal(row.news_date,'2026-10-13');
});
