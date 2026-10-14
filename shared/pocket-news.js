import {marketDay,symbolOf} from './markets.js';
export const POCKET_HOSTS=['www.pocket.tw','pocket.tw'];
export function isPocketURL(value){try{return POCKET_HOSTS.includes(new URL(value).hostname.toLowerCase());}catch{return false;}}
export function pocketArticleURL(value){
 const u=new URL(value);if(u.protocol!=='https:'||u.username||u.password||u.port||!POCKET_HOSTS.includes(u.hostname)||!/^\/school\/report\/[a-zA-Z0-9_-]+\/\d+\/?$/.test(u.pathname))throw Error('僅支援口袋學堂個別研究／市場文章');
 u.search='';u.hash='';return u.href;
}
export function pocketMarketMatches(title,code,category=''){
 const text=String(title||'').normalize('NFKC'),context=text+' '+String(category||''),us=String(code||'').startsWith('US:'),symbol=us?code.slice(3):code;
 const explicit=new RegExp(us?'(?<![A-Za-z0-9])'+symbol.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'(?![A-Za-z0-9.-])':'(?<!\\d)'+symbol+'(?!\\d)','i').test(text);
 const usContext=/美股|美國股市|NYSE|NASDAQ/i.test(context),twContext=/台股|臺股/.test(context);
 const dual={'US:TSM':'2330','US:UMC':'2303','US:ASX':'3711','US:AUOTY':'2409'};
 if(us){
  if(dual[code]&&!explicit&&!/ADR/i.test(text)&&(new RegExp('(?<!\\d)'+dual[code]+'(?!\\d)').test(text)||!usContext))return false;
  if(twContext&&!usContext&&!explicit)return false;
 }else if((/ADR/i.test(text)||usContext&&!twContext)&&!explicit)return false;
 return true;
}
function decode(value){return String(value||'').replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi,(_,entity)=>{const named={amp:'&',lt:'<',gt:'>',quot:'"',apos:"'"};if(named[entity.toLowerCase()])return named[entity.toLowerCase()];const n=/^#x/i.test(entity)?parseInt(entity.slice(2),16):Number(entity.slice(1));return n>0&&n<=0x10ffff?String.fromCodePoint(n):'';});}
export function pocketArticleFields(html){
 const tag=String(html||'').match(/<InvestNewsContent\b(?:[^"'<>]|"[^"]*"|'[^']*')*>/i)?.[0];if(!tag)return null;
 const fields={};for(const m of tag.matchAll(/\b(data-[\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g))fields[m[1]]=decode(m[2]??m[3]);
 if(!fields['data-content'])return null;
 return {title:fields['data-title']||'',date:fields['data-date']||'',category:fields['data-news_type']||'',html:fields['data-content'].replace(/\\r\\n|\\n|\\r/g,'\n')};
}
export function pocketIndexRows(payload,company,{from,now=new Date(),mention}={}){
 if(String(payload?.code)!=='0'||!Array.isArray(payload.data))throw Error('口袋證券新聞索引格式異常');
 const start=from?marketDay(from,'TW'):'0000-01-01',today=marketDay(now,'TW'),rows=[];
 for(const item of payload.data){
  const title=String(item.Title||''),date=String(item.date||'');if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||date<start||date>today||!title||!mention(title,company)||!pocketMarketMatches(title,company.code))continue;
  try{const url=pocketArticleURL(new URL(item.slug,'https://www.pocket.tw').href);rows.push({company_code:company.code,title,url,article_url:url,source:'口袋證券',published_at:date,news_date:date});}catch{}
 }
 return rows;
}
export async function fetchPocketNews(company,{from,now=new Date(),mention,fetcher=globalThis.fetch,maxPages=5,timeout=15000}={}){
 const rows=new Map(),warnings=[],deadline=AbortSignal.timeout(timeout),keywords=[...new Set([String(company.name||'').replace(/\s*ADR$/i,''),company.full_name,symbolOf(company.code)].filter(Boolean))];
 for(const keyword of keywords){
  for(let page=1;page<=maxPages;page++){
   try{const url=new URL('https://www.pocket.tw/invest_news/api/invest_news/');url.search=new URLSearchParams({page:String(page),category:'',keyword}).toString();
    const response=await fetcher(url,{signal:deadline,redirect:'error',headers:{Accept:'application/json','User-Agent':'StockNewsCalendar/2.0'}});if(!response.ok)throw Error('HTTP '+response.status);
    const data=await response.json();for(const row of pocketIndexRows(data,company,{from,now,mention}))rows.set(row.url,row);
    const dates=data.data.map(r=>r.date).filter(d=>/^\d{4}-\d{2}-\d{2}$/.test(d));if(!data.data.length||page>=Number(data.pages)||from&&dates.length===data.data.length&&dates.every(d=>d<marketDay(from,'TW')))break;
   }catch(e){warnings.push('口袋證券：'+e.message);break;}
  }if(deadline.aborted)break;
 }
 return {news:[...rows.values()],warnings:[...new Set(warnings)]};
}
