import usCompaniesData from './us-companies.json' with {type:'json'};
// Keep the existing Taiwan IDs stable; US listings are explicitly namespaced.
export const isUS = code => /^US:[A-Z][A-Z0-9.-]{0,14}$/.test(String(code||''));
export const validStockCode = code => /^\d{4,6}$/.test(String(code||'')) || isUS(code);
export const marketOf = value => isUS(typeof value==='string'?value:value?.company_code||value?.code) ? 'US' : 'TW';
export const symbolOf = code => isUS(code)?code.slice(3):code;
export const marketLabel = value => marketOf(value)==='US'?'美股':'台股';
export function marketDay(now=new Date(),market='TW'){
 return new Intl.DateTimeFormat('en-CA',{timeZone:market==='US'?'America/New_York':'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
}
export function marketParts(now=new Date(),market='TW'){
 const parts=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:market==='US'?'America/New_York':'Asia/Taipei',hourCycle:'h23',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}).formatToParts(now).map(p=>[p.type,p.value]));
 return {day:`${parts.year}-${parts.month}-${parts.day}`,minute:Number(parts.hour)*60+Number(parts.minute)};
}
export function completedMarketDay(now=new Date(),market='TW'){
 const p=marketParts(now,market);let day=p.day;
 // US core session ends at 16:00 ET. Actual available bars are authoritative
 // for exchange holidays and early closes; never synthesize trading sessions.
 if(p.minute<(market==='US'?960:810))day=new Date(Date.parse(day+'T00:00:00Z')-86400000).toISOString().slice(0,10);
 if(market==='US')while([0,6].includes(new Date(day+'T00:00:00Z').getUTCDay()))day=new Date(Date.parse(day+'T00:00:00Z')-86400000).toISOString().slice(0,10);
 return day;
}
export const marketCompanies=(rows,market)=>rows.filter(c=>market==='ALL'||marketOf(c)===market);
export const usCompanies=usCompaniesData;
export function enrichCompany(c){if(!c||!isUS(c.code))return c;const seed=usCompanies.find(s=>s.code===c.code);return {...seed,...c,symbol:symbolOf(c.code),market:'美股',currency:'USD',timezone:'America/New_York',aliases:seed?.aliases||[c.name,c.full_name].filter(Boolean)};}
export function companyAliases(c){return [...new Set([c.name,c.full_name,...(c.aliases||[])].filter(Boolean))];}
export function usMention(title,c){
 const text=String(title||'').normalize('NFKC'),escape=s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
 const nameMatch=companyAliases(enrichCompany(c)).filter(n=>n.length>=2).some(n=>/[\u3400-\u9fff]/.test(n)?text.includes(n):new RegExp('(?<![A-Za-z0-9])'+escape(n)+'(?![A-Za-z0-9])','i').test(text));
 const symbol=symbolOf(c.code);
 // Short English tickers (A, ON, ARM) need explicit ticker syntax, not prose.
 const ticker=new RegExp('(?:\\$|\\b(?:NYSE|NASDAQ|ticker)\\s*[:：]\\s*)'+escape(symbol)+'(?![A-Za-z0-9.-])','i');
 return nameMatch||ticker.test(text)||symbol.length>=2&&!['ON','IT','AI','ALL','ARE','CAN','FOR','NOW','ARM','CAT'].includes(symbol)&&new RegExp('(?<![A-Za-z0-9])'+escape(symbol)+'(?![A-Za-z0-9.-])').test(text);
}
export const US_NEWS_DOMAINS={'www.reuters.com':'Reuters','reuters.com':'Reuters','www.cnbc.com':'CNBC','cnbc.com':'CNBC','finance.yahoo.com':'Yahoo Finance','www.marketwatch.com':'MarketWatch','marketwatch.com':'MarketWatch'};
export function newsQuery(c,range='when:1m'){
 const names=companyAliases(enrichCompany(c)).filter(n=>n.length>=2).map(n=>'"'+n.replaceAll('"','')+'"');
 const us=isUS(c.code);return '('+[...names,'"'+symbolOf(c.code)+'"'].join(' OR ')+') '+(us?'(site:reuters.com OR site:cnbc.com OR site:finance.yahoo.com OR site:marketwatch.com OR site:cna.com.tw OR site:moneydj.com OR site:news.cnyes.com OR site:pocket.tw/school/report)':'(site:cna.com.tw OR site:moneydj.com OR site:news.cnyes.com OR site:pocket.tw/school/report)')+' '+range;
}
