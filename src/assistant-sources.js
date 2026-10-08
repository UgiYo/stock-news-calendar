export function findAssistantCompany(question,companies,selected=''){
 const normalize=s=>String(s||'').normalize('NFKC').replaceAll('臺','台').toLowerCase();
 const q=normalize(question);
 const found=companies.filter(c=>new RegExp('(^|[^0-9])'+c.code+'([^0-9]|$)').test(q)||[c.name,c.full_name].filter(Boolean).some(n=>q.includes(normalize(n).replace(/[＊*]+$/,''))));
 return found.length?found:selected?companies.filter(c=>c.code===selected):[];
}
export function assistantDateRange(question){
 const periods=[...question.matchAll(/(20\d{2})年(?:(\d{1,2})月(?:(\d{1,2})日?)?)?|(20\d{2})[-/](\d{1,2})(?:[-/](\d{1,2}))?/g)].map(m=>{
  const year=Number(m[1]||m[4]),month=Number(m[2]||m[5]||0),day=Number(m[3]||m[6]||0);
  if(month>12||day>31)return null;
  const prefix=String(year)+(month?'-'+String(month).padStart(2,'0'):'');
  return day?{from:prefix+'-'+String(day).padStart(2,'0'),to:prefix+'-'+String(day).padStart(2,'0')}:{from:prefix+(month?'-01':'-01-01'),to:prefix+(month?'-'+new Date(Date.UTC(year,month,0)).getUTCDate():'-12-31')};
 }).filter(Boolean);
 return periods.length?{from:periods.map(p=>p.from).sort()[0],to:periods.map(p=>p.to).sort().at(-1)}:null;
}
export function assistantSources(question,{companies=[],selected='',news=[],records=[]}={}){
 const stocks=findAssistantCompany(question,companies,selected),codes=new Set(stocks.map(s=>s.code));
 const terms=[...new Set(question.match(/[a-zA-Z0-9]+|[\u4e00-\u9fff]{2,}/g)||[])];
 const match=text=>stocks.some(c=>text.includes(c.name.replace(/[＊*]+$/,''))||text.includes(c.code))||terms.some(t=>text.includes(t));
 const range=assistantDateRange(question);
 let topic=question;for(const c of stocks)for(const term of [c.code,c.name?.replace(/[＊*]+$/,''),c.full_name].filter(Boolean))topic=topic.replaceAll(term,' ');
 topic=topic.replace(/20\d{2}(?:年|[-/])?(?:\d{1,2}(?:月|[-/])?(?:\d{1,2}日?)?)?/g,' ').replace(/請|幫我|整理|查詢|新聞|近期|過去|有哪些|有什麼|消息|內容|一下|全部|既有|相關|觀察|分析|搜尋|最近|可能|原因/g,' ');
 const keywords=[...new Set((topic.match(/[a-zA-Z]{2,}|[\u4e00-\u9fff]{2,}/g)||[]).flatMap(t=>[t,...(t.length>2?[...t].slice(0,-1).map((_,i)=>t.slice(i,i+2)):[])]))];
 const relevance=c=>keywords.reduce((sum,k)=>sum+(c.title.includes(k)?4:0)+(c.text.includes(k)?1:0),0);
 const candidates=[];
 for(const n of news){if(codes.size?!codes.has(n.company_code):!(match(n.title+' '+(n.article_summary||''))||keywords.some(k=>(n.title+' '+(n.article_summary||'')).includes(k))))continue;candidates.push({kind:'新聞',title:n.title,date:n.news_date||n.published_at,url:n.article_url||n.url,text:[n.title,n.article_summary||n.summary||n.description||'僅有標題，未取得新聞全文'].join('\n')});}
 for(const r of records){if(r.kind!=='podcast'||!r.text&&!r.answer)continue;const text=[r.text||'',r.answer||''].join('\n');if(!match(text))continue;
 const lines=text.split('\n'),hits=lines.flatMap((line,i)=>match(line)?[...lines.slice(Math.max(0,i-1),i+2)]:[]);
 candidates.push({kind:'Podcast',title:r.title,date:r.date||r.episode?.date,url:r.episode?.url||r.episode?.audio_url||'',text:(hits.length?hits.join('\n'):text).slice(0,6000)+(r.partial?'\n注意：此集只有部分逐字稿。':'' )});
 }
 const unique=new Map();for(const c of candidates.filter(c=>!range||(String(c.date||'').slice(0,10)>=range.from&&String(c.date||'').slice(0,10)<=range.to)).sort((a,b)=>relevance(b)-relevance(a)||String(b.date).localeCompare(String(a.date)))){const key=c.kind+':'+(c.url||c.title)+':'+c.date;if(!unique.has(key))unique.set(key,c);}
 return [...unique.values()].slice(0,12).map((s,i)=>({...s,id:'S'+(i+1)}));
}
