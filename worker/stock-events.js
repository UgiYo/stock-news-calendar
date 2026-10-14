import {fetchPocketNews} from '../shared/pocket-news.js';
import {isUS,validStockCode,marketOf,newsQuery,enrichCompany} from '../shared/markets.js';
import {readUSPrices,fetchUSFilings} from './us-market.js';
import {completedDay,detectMovement,newsWindow,shiftDay} from '../shared/stock-movements.js';
export async function stockEventsRoute(req,{sql,reply,user,parsePreview,curateNews,companyMention,fetcher=fetch,env={}}){
 const url=new URL(req.url);if(!['/stock-movements','/stock-event-news'].includes(url.pathname))return null;
 if(!user?.id)return reply({error:'請先登入'},401);
 if(!['GET','POST'].includes(req.method))return reply({error:'Method not allowed'},405);
 const requested=(url.searchParams.get('code')||url.searchParams.get('codes')?.split(',')[0]),market=marketOf(requested);
 const date=url.searchParams.get('date')||completedDay(new Date(),market),cutoff=completedDay(new Date(),market);
 if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date))||date>cutoff)return reply({error:'請選擇已收盤的日期'},400);
 const readPrices=async codes=>{if(codes.some(isUS)){const rows=[];for(const code of codes)rows.push(...await readUSPrices(sql,code));return rows;}try{const rows=[];for(let at=0;at<codes.length;at+=90){const batch=codes.slice(at,at+90);rows.push(...(await sql(`SELECT * FROM prices WHERE code IN (${[...batch,'TAIEX'].map(()=>'?').join(',')}) AND date BETWEEN ? AND ? ORDER BY date`,...batch,'TAIEX',shiftDay(date,-180),date).all()).results);}return rows;}catch(e){if(String(e.message).includes('no such table'))return [];throw e;}};
 if(url.pathname==='/stock-movements'){
  const codes=[...new Set((url.searchParams.get('codes')||'').split(',').filter(Boolean))];
  if(!codes.length||codes.length>100||codes.some(c=>!validStockCode(c)||marketOf(c)!==market))return reply({error:'Invalid stock codes'},400);
  const prices=await readPrices(codes);return reply({owner_id:user.id,date,movements:codes.map(code=>detectMovement(prices,{code,date}))});
 }
 const code=url.searchParams.get('code'),lookback=Number(url.searchParams.get('lookback')||45);
 if(!validStockCode(code)||![30,45].includes(lookback))return reply({error:'Invalid event range'},400);
 const company=enrichCompany(await sql('SELECT * FROM companies WHERE code=?',code).first());if(!company)return reply({error:'公司不存在'},404);
 const movement=detectMovement(await readPrices([code]),{code,date});if(!movement.from)return reply({error:'行情不足，請先在個股走勢更新日線'},422);
 const range=newsWindow(movement,lookback),saved=(await sql('SELECT * FROM news WHERE company_code=? AND news_date BETWEEN ? AND ? ORDER BY published_at',code,range.from,range.to).all()).results;
 const conflicts=(await sql('SELECT name FROM companies WHERE code<>? AND name<>? AND instr(name,?)>0',code,company.name,company.name).all()).results.map(r=>r.name),rows=[...saved],failures=[];
 // Date-bounded weekly searches avoid the old one-month preview limitation.
 const chunks=[];for(let from=range.from;from<=range.to;from=shiftDay(from,7))chunks.push({from,to:shiftDay(from,6)<range.to?shiftDay(from,6):range.to});
 for(let i=0;i<chunks.length;i+=3)await Promise.all(chunks.slice(i,i+3).map(async chunk=>{
  try{const feed=new URL('https://news.google.com/rss/search');feed.search=new URLSearchParams({q:newsQuery(company,`after:${shiftDay(chunk.from,-1)} before:${shiftDay(chunk.to,1)}`),hl:market==='US'?'en-US':'zh-TW',gl:market==='US'?'US':'TW',ceid:market==='US'?'US:en':'TW:zh-Hant'}).toString();
   const response=await fetcher(feed,{signal:AbortSignal.timeout(12000)});if(!response.ok)throw Error('RSS '+response.status);
   rows.push(...parsePreview(await response.text(),company,new Date(shiftDay(chunk.to,1)+(market==='US'?'T05:00:00Z':'T00:00:00+08:00')),conflicts,new Date(chunk.from+(market==='US'?'T00:00:00Z':'T00:00:00+08:00'))));
  }catch(e){failures.push(`${chunk.from}～${chunk.to}：${e.message}`);}
 }));
 const pocket=await fetchPocketNews(company,{from:new Date(range.from+'T00:00:00+08:00'),now:new Date(range.to+'T23:59:59+08:00'),mention:(title,c)=>companyMention(title,c,conflicts),fetcher,maxPages:8,timeout:12000});rows.push(...pocket.news);failures.push(...pocket.warnings);
 let filings=[];if(market==='US')try{filings=(await fetchUSFilings(company,env,fetcher)).filter(r=>r.news_date>=range.from&&r.news_date<=range.to);}catch(e){failures.push('SEC 公告：'+e.message);}
 const news=[...curateNews(rows.filter(r=>r.news_date>=range.from&&r.news_date<=range.to&&companyMention(r.title,company,conflicts))),...filings].sort((a,b)=>String(a.published_at).localeCompare(String(b.published_at)));
 return reply({owner_id:user.id,company,movement,news,coverage:{...range,lookback,searchSegments:chunks.length,failedSegments:failures.length,failures,count:news.length,first:news[0]?.news_date||null,last:news.at(-1)?.news_date||null,fetchedAt:new Date().toISOString(),market,timezone:market==='US'?'America/New_York':'Asia/Taipei',complete:false,note:'已依日期區間查詢；搜尋來源不保證完整收錄，沒有回傳新聞不代表當天沒有事件。'}});
}
