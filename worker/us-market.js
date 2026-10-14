import {fetchPocketNews} from '../shared/pocket-news.js';
import {companyMention,curateNews} from '../src/news-policy.js';
import {isUS,symbolOf,usCompanies,enrichCompany,completedMarketDay,marketDay,newsQuery} from '../shared/markets.js';
import {recordNewsAttempt} from './news-diagnostics.js';
let catalogCache=null;
const secHeaders=env=>({'User-Agent':env.SEC_USER_AGENT||'StockNewsCalendar https://github.com/UgiYo/stock-news-calendar','Accept':'application/json'});
export async function usCatalog(env,fetcher=fetch){
 if(catalogCache&&Date.now()-catalogCache.at<86400000)return catalogCache.rows;
 const r=await fetcher('https://www.sec.gov/files/company_tickers_exchange.json',{headers:secHeaders(env),signal:AbortSignal.timeout(10000)});
 if(!r.ok)throw Error('SEC 公司清單 HTTP '+r.status);const data=await r.json(),fields=data.fields;
 if(!Array.isArray(fields)||!Array.isArray(data.data))throw Error('SEC 公司清單格式異常');
 const rows=data.data.map(row=>Object.fromEntries(fields.map((f,i)=>[f,row[i]]))).filter(c=>['Nasdaq','NYSE','CBOE'].includes(c.exchange)).map(c=>enrichCompany({code:'US:'+c.ticker.replace('-', '.'),name:usCompanies.find(s=>s.symbol===c.ticker.replace('-', '.'))?.name||c.name,full_name:c.name,market:'美股',exchange:c.exchange,cik:String(c.cik).padStart(10,'0')})).filter(c=>isUS(c.code));
 catalogCache={at:Date.now(),rows};return rows;
}
export async function lookupUSSymbol(query,fetcher=fetch){
 const symbol=query.toUpperCase();if(!/^[A-Z][A-Z0-9.-]{0,14}$/.test(symbol))return null;
 const providerSymbol=symbol.replace('.', '-');
 for(const host of ['query1.finance.yahoo.com','query2.finance.yahoo.com'])try{
  const r=await fetcher(`https://${host}/v8/finance/chart/${encodeURIComponent(providerSymbol)}?interval=1d&range=5d`,{headers:{'User-Agent':'Mozilla/5.0','Accept':'application/json'},signal:AbortSignal.timeout(5000)});
  if(!r.ok)continue;const m=(await r.json()).chart?.result?.[0]?.meta;
  if(m?.symbol?.toUpperCase()!==providerSymbol||m.currency!=='USD'||!['EQUITY','ETF'].includes(m.instrumentType)||!['NMS','NYQ','NGM','NCM','PCX','ASE','BTS','BATS','NYSE','NASDAQ','NASDAQGS','NASDAQGM','NASDAQCM','NYSEARCA','CBOE'].includes(String(m.exchangeName||'').toUpperCase()))continue;
  const name=m.longName||m.shortName;if(typeof name!=='string'||!name.trim())continue;
  return enrichCompany({code:'US:'+symbol,name,full_name:name,exchange:m.exchangeName,market:'美股'});
 }catch{}
 return null;
}
export async function searchUS(q,env,fetcher=fetch){
 const key=q.normalize('NFKC').trim().replace(/^(?:US|NASDAQ|NYSE)\s*:\s*/i,'').toLowerCase();
 if(!key)return {companies:[]};
 const exact=c=>[c.symbol,c.name,c.full_name,...(c.aliases||[])].some(s=>String(s||'').toLowerCase()===key);
 const matches=rows=>rows.filter(c=>[c.code,c.symbol,c.name,c.full_name,...(c.aliases||[])].some(s=>String(s||'').toLowerCase().includes(key))).sort((a,b)=>Number(exact(b))-Number(exact(a))||a.code.localeCompare(b.code)).slice(0,20);
 const seeded=matches(usCompanies);
 // Common exact searches must not wait for a large remote catalog download.
 if(seeded.some(exact))return {companies:seeded};
 let rows=[...usCompanies],warning='';
 try{const official=await usCatalog(env,fetcher);const map=new Map(rows.map(c=>[c.code,c]));for(const c of official)map.set(c.code,c);rows=[...map.values()];}
 catch{warning='SEC 公司清單暫時無法讀取，已使用常用公司清單；股票代號另嘗試行情來源核對。';}
 let companies=matches(rows);
 if(!companies.some(c=>c.symbol?.toLowerCase()===key)){
  const lookup=await lookupUSSymbol(key,fetcher);
  if(lookup)companies=[lookup,...companies.filter(c=>c.code!==lookup.code)].slice(0,20);
 }
 return {companies,warning};
}
export function usDailyBars(result,code,now=new Date()){
 const quote=result.indicators?.quote?.[0],adj=result.indicators?.adjclose?.[0]?.adjclose,cutoff=completedMarketDay(now,'US');
 return (result.timestamp||[]).flatMap((t,i)=>{
  const date=marketDay(new Date(t*1000),'US'),[open,high,low,close]=['open','high','low','close'].map(k=>quote?.[k]?.[i]);
  if(date>cutoff||![open,high,low,close].every(v=>Number.isFinite(v)&&v>0)||low>Math.min(open,close)||high<Math.max(open,close))return [];
  return [{code,date,open,high,low,close,volume:Number.isFinite(quote?.volume?.[i])?quote.volume[i]:null,adjusted_close:Number.isFinite(adj?.[i])&&adj[i]>0?adj[i]:null}];
 });
}
export async function fetchUSPrices(code,fetcher=fetch){
 const symbol=symbolOf(code).replace('.', '-');let lastError;
 for(const host of ['query1.finance.yahoo.com','query2.finance.yahoo.com'])try{
  const r=await fetcher(`https://${host}/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=2y&includePrePost=false&events=div%2Csplits`,{headers:{'User-Agent':'Mozilla/5.0','Accept':'application/json'},signal:AbortSignal.timeout(10000)});
  if(!r.ok)throw Error('行情 HTTP '+r.status);const result=(await r.json()).chart?.result?.[0];
  if(result?.meta?.symbol?.toUpperCase()!==symbol)throw Error('行情代號不符');
  const rows=usDailyBars(result,code);if(!rows.length)throw Error('尚無已收盤行情');return {rows,source:'Yahoo Finance',currency:'USD',timezone:'America/New_York'};
 }catch(e){lastError=e;}
 throw Error('美股行情暫時無法取得，請稍後重試：'+lastError.message);
}
export async function ensureUSPrices(sql){
 await sql('CREATE TABLE IF NOT EXISTS prices(code TEXT NOT NULL,date TEXT NOT NULL,open REAL,high REAL,low REAL,close REAL NOT NULL,volume REAL,PRIMARY KEY(code,date))').run();
 await sql('CREATE TABLE IF NOT EXISTS us_price_facts(code TEXT NOT NULL,date TEXT NOT NULL,adjusted_close REAL,source TEXT,updated_at INTEGER,PRIMARY KEY(code,date))').run();
}
export async function readUSPrices(sql,code){
 await ensureUSPrices(sql);return (await sql("SELECT p.*,f.adjusted_close,f.source,f.updated_at FROM prices p LEFT JOIN us_price_facts f ON p.code=f.code AND p.date=f.date WHERE p.code=? AND p.date>=date('now','-2 years') ORDER BY p.date",code).all()).results;
}
export async function saveUSPrices(sql,db,rows,source='Yahoo Finance'){
 await ensureUSPrices(sql);const at=Date.now();
 for(let i=0;i<rows.length;i+=20)await db.batch(rows.slice(i,i+20).flatMap(p=>[
 sql('INSERT INTO prices(code,date,open,high,low,close,volume) VALUES(?,?,?,?,?,?,?) ON CONFLICT(code,date) DO UPDATE SET open=excluded.open,high=excluded.high,low=excluded.low,close=excluded.close,volume=excluded.volume',p.code,p.date,p.open,p.high,p.low,p.close,p.volume),
 sql('INSERT INTO us_price_facts(code,date,adjusted_close,source,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(code,date) DO UPDATE SET adjusted_close=excluded.adjusted_close,source=excluded.source,updated_at=excluded.updated_at',p.code,p.date,p.adjusted_close??null,source,at)
 ]));
}
export async function fetchUSFilings(company,env,fetcher=fetch){
 const c=company.cik?company:(await usCatalog(env,fetcher)).find(c=>c.code===company.code);if(!c?.cik)return [];
 const r=await fetcher(`https://data.sec.gov/submissions/CIK${c.cik}.json`,{headers:secHeaders(env),signal:AbortSignal.timeout(10000)});if(!r.ok)throw Error('SEC 公告 HTTP '+r.status);
 const data=await r.json();if(String(data.cik).padStart(10,'0')!==c.cik)throw Error('SEC 公司識別不符');const recent=data.filings?.recent||{};
 return (recent.accessionNumber||[]).flatMap((n,i)=>{
  const form=recent.form?.[i],date=recent.filingDate?.[i],document=recent.primaryDocument?.[i];if(!['10-K','10-Q','8-K','20-F','6-K'].includes(form)||!/^\d{4}-\d{2}-\d{2}$/.test(date||'')||!document)return [];
  return [{company_code:company.code,title:`${company.name} · ${form} 公司申報`,source:'SEC EDGAR',news_date:date,published_at:recent.acceptanceDateTime?.[i]||null,url:`https://www.sec.gov/Archives/edgar/data/${Number(c.cik)}/${n.replaceAll('-','')}/${encodeURIComponent(document)}`,form,evidence_kind:'filing_metadata'}];
 }).slice(0,40);
}
export async function usMarketRoute(req,env,{sql,reply,user,parsePreview,fetcher=fetch}){
 const url=new URL(req.url),path=url.pathname,code=url.searchParams.get('code');
 if(path==='/companies'&&(url.searchParams.get('market')==='US'||/^US:/i.test(url.searchParams.get('q')||''))){
  if(req.method!=='GET')return reply({error:'Method not allowed'},405);
  const q=(url.searchParams.get('q')||'').trim().slice(0,60);if(!q)return reply({companies:[]});const result=await searchUS(q,env,fetcher);
  if(result.companies.length)await env.DB.batch(result.companies.map(c=>sql('INSERT INTO companies(code,name,full_name,market) VALUES(?,?,?,?) ON CONFLICT(code) DO UPDATE SET name=excluded.name,full_name=excluded.full_name,market=excluded.market WHERE companies.name IS NOT excluded.name OR companies.full_name IS NOT excluded.full_name OR companies.market IS NOT excluded.market',c.code,c.name,c.full_name,'美股')));
  return reply(result);
 }
 if(!isUS(code))return null;
 if(!user?.id)return reply({error:'請先登入'},401);
 const company=enrichCompany(await sql('SELECT * FROM companies WHERE code=?',code).first());if(!company)return reply({error:'公司不存在，請先搜尋並追蹤'},404);
 if(path==='/ranking-stock')return reply({stock:company,history:[],market:'US'});
 if(path==='/company-profile')return reply({profile:{code,heading:symbolOf(code)+' '+company.name,introduction:company.full_name,metrics:[{label:'交易市場',value:company.exchange||'美股'},{label:'計價幣別',value:'USD'}],source:'公司識別資料',url:'https://www.sec.gov/edgar/search/#/q='+encodeURIComponent(company.full_name),fetchedAt:new Date().toISOString(),notice:'美股公司申報可在下方 SEC 公告查看；此處未提供財務比率。'}});
 if(path==='/us-filings'){try{return reply({company,filings:await fetchUSFilings(company,env,fetcher)});}catch(e){return reply({company,filings:[],warning:e.message});}}
 if(path==='/intraday')return reply({error:'美股第一版提供收盤日／週／月 K，尚未接入盤中行情。'},422);
 if(path==='/chart-prices'||path==='/prices'){
  if(!['GET','POST'].includes(req.method))return reply({error:'Method not allowed'},405);
  if(path==='/prices'&&!await sql('SELECT 1 FROM watchlists WHERE user_id=? AND company_code=?',user.id,code).first())return reply({error:'請先追蹤公司'},403);
  const prices=await readUSPrices(sql,code),last=prices.at(-1),at=last?.updated_at||0,refresh=req.method==='POST'||!prices.length||Date.now()-at>86400000||last?.date<completedMarketDay(new Date(),'US')&&Date.now()-at>3600000;
  if(!refresh)return reply({prices,source:last?.source,currency:'USD',timezone:'America/New_York',updatedAt:at,refreshed:false});
  try{const result=await fetchUSPrices(code,fetcher);await saveUSPrices(sql,env.DB,result.rows,result.source);return reply({prices:await readUSPrices(sql,code),source:result.source,currency:'USD',timezone:'America/New_York',updatedAt:Date.now(),refreshed:true});}
  catch(e){return prices.length?reply({prices,currency:'USD',timezone:'America/New_York',refreshed:false,warning:e.message}):reply({error:e.message},502);}
 }
 if(path==='/preview'){
  if(req.method!=='GET')return reply({error:'Method not allowed'},405);
  if(url.searchParams.get('stored')==='1')return reply({company,news:(await sql("SELECT * FROM news WHERE company_code=? AND published_at>=? ORDER BY published_at DESC,id DESC",code,new Date(Date.now()-32*86400000).toISOString()).all()).results});
  const feed=new URL('https://news.google.com/rss/search');feed.search=new URLSearchParams({q:newsQuery(company),hl:'en-US',gl:'US',ceid:'US:en'}).toString();
  const pocketPromise=fetchPocketNews(company,{from:new Date(Date.now()-32*86400000),mention:companyMention,fetcher});
  try{const response=await fetcher(feed,{signal:AbortSignal.timeout(20000)});if(!response.ok)throw Error('Google News RSS HTTP '+response.status);const rss=parsePreview(await response.text(),company),pocket=await pocketPromise;return reply({company,news:curateNews([...rss,...pocket.news]),timezone:'America/New_York',...(pocket.warnings.length?{warnings:pocket.warnings}:{})});}
  catch(e){const pocket=await pocketPromise;if(pocket.news.length)return reply({company,news:curateNews(pocket.news),timezone:'America/New_York',warnings:['Google News 暫時無法讀取，已提供口袋證券來源',...pocket.warnings]});await recordNewsAttempt(sql,{code,stage:'preview',status:'failed',details:{error:e.message}});return reply({error:'美股新聞來源暫時無法讀取：'+e.message,code:'NEWS_SOURCE_UNAVAILABLE'},502);}
 }
 return null;
}
