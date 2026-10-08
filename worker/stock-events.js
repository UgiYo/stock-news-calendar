import {completedDay,detectMovement,newsWindow,shiftDay} from '../shared/stock-movements.js';
export async function stockEventsRoute(req,{sql,reply,user,parsePreview,curateNews,companyMention,fetcher=fetch}){
 const url=new URL(req.url);if(!['/stock-movements','/stock-event-news'].includes(url.pathname))return null;
 if(!user?.id)return reply({error:'請先登入'},401);
 if(!['GET','POST'].includes(req.method))return reply({error:'Method not allowed'},405);
 const date=url.searchParams.get('date')||completedDay(),cutoff=completedDay();
 if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date))||date>cutoff)return reply({error:'請選擇已收盤的日期'},400);
 const readPrices=async codes=>{try{return (await sql(`SELECT * FROM prices WHERE code IN (${[...codes,'TAIEX'].map(()=>'?').join(',')}) AND date BETWEEN ? AND ? ORDER BY date`,...codes,'TAIEX',shiftDay(date,-180),date).all()).results;}catch(e){if(String(e.message).includes('no such table'))return [];throw e;}};
 if(url.pathname==='/stock-movements'){
  const codes=[...new Set((url.searchParams.get('codes')||'').split(',').filter(Boolean))];
  if(!codes.length||codes.length>100||codes.some(c=>!/^\d{4}$/.test(c)))return reply({error:'Invalid stock codes'},400);
  const prices=await readPrices(codes);return reply({owner_id:user.id,date,movements:codes.map(code=>detectMovement(prices,{code,date}))});
 }
 const code=url.searchParams.get('code'),lookback=Number(url.searchParams.get('lookback')||45);
 if(!/^\d{4}$/.test(code||'')||![30,45].includes(lookback))return reply({error:'Invalid event range'},400);
 const company=await sql('SELECT * FROM companies WHERE code=?',code).first();if(!company)return reply({error:'公司不存在'},404);
 const movement=detectMovement(await readPrices([code]),{code,date});if(!movement.from)return reply({error:'行情不足，請先在個股走勢更新日線'},422);
 const range=newsWindow(movement,lookback),saved=(await sql('SELECT * FROM news WHERE company_code=? AND news_date BETWEEN ? AND ? ORDER BY published_at',code,range.from,range.to).all()).results;
 const conflicts=(await sql('SELECT name FROM companies WHERE code<>? AND name<>? AND instr(name,?)>0',code,company.name,company.name).all()).results.map(r=>r.name),rows=[...saved],failures=[];
 // Date-bounded weekly searches avoid the old one-month preview limitation.
 const chunks=[];for(let from=range.from;from<=range.to;from=shiftDay(from,7))chunks.push({from,to:shiftDay(from,6)<range.to?shiftDay(from,6):range.to});
 for(let i=0;i<chunks.length;i+=3)await Promise.all(chunks.slice(i,i+3).map(async chunk=>{
  try{const feed=new URL('https://news.google.com/rss/search');feed.search=new URLSearchParams({q:`("${company.name}" OR "${company.full_name||company.name}" OR "${code}") (site:cna.com.tw OR site:moneydj.com OR site:news.cnyes.com) after:${shiftDay(chunk.from,-1)} before:${shiftDay(chunk.to,1)}`,hl:'zh-TW',gl:'TW',ceid:'TW:zh-Hant'}).toString();
   const response=await fetcher(feed,{signal:AbortSignal.timeout(12000)});if(!response.ok)throw Error('RSS '+response.status);
   rows.push(...parsePreview(await response.text(),company,new Date(chunk.to+'T15:59:59.999Z'),conflicts,new Date(chunk.from+'T00:00:00+08:00')));
  }catch(e){failures.push(`${chunk.from}～${chunk.to}：${e.message}`);}
 }));
 const news=curateNews(rows.filter(r=>r.news_date>=range.from&&r.news_date<=range.to&&companyMention(r.title,company,conflicts))).sort((a,b)=>String(a.published_at).localeCompare(String(b.published_at)));
 return reply({owner_id:user.id,company,movement,news,coverage:{...range,lookback,searchSegments:chunks.length,failedSegments:failures.length,failures,count:news.length,first:news[0]?.news_date||null,last:news.at(-1)?.news_date||null,fetchedAt:new Date().toISOString(),complete:false,note:'已依日期區間查詢；搜尋來源不保證完整收錄，沒有回傳新聞不代表當天沒有事件。'}});
}
