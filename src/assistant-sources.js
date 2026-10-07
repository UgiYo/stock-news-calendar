export function findAssistantCompany(question,companies,selected=''){
 const normalize=s=>String(s||'').normalize('NFKC').replaceAll('臺','台').toLowerCase();
 const q=normalize(question);
 const found=companies.filter(c=>new RegExp('(^|[^0-9])'+c.code+'([^0-9]|$)').test(q)||[c.name,c.full_name].filter(Boolean).some(n=>q.includes(normalize(n).replace(/[＊*]+$/,''))));
 return found.length?found:selected?companies.filter(c=>c.code===selected):[];
}
export function assistantSources(question,{companies=[],selected='',news=[],records=[]}={}){
 const stocks=findAssistantCompany(question,companies,selected),codes=new Set(stocks.map(s=>s.code));
 const terms=[...new Set(question.match(/[a-zA-Z0-9]+|[\u4e00-\u9fff]{2,}/g)||[])];
 const match=text=>stocks.some(c=>text.includes(c.name.replace(/[＊*]+$/,''))||text.includes(c.code))||terms.some(t=>text.includes(t));
 const candidates=[];
 for(const n of news){if(codes.size?!codes.has(n.company_code):!match(n.title+' '+(n.article_summary||'')))continue;candidates.push({kind:'新聞',title:n.title,date:n.news_date||n.published_at,url:n.article_url||n.url,text:[n.title,n.article_summary||n.summary||n.description||'僅有標題，未取得新聞全文'].join('\n')});}
 for(const r of records){if(r.kind!=='podcast'||!r.text&&!r.answer)continue;const text=[r.text||'',r.answer||''].join('\n');if(!match(text))continue;
 const lines=text.split('\n'),hits=lines.flatMap((line,i)=>match(line)?[...lines.slice(Math.max(0,i-1),i+2)]:[]);
 candidates.push({kind:'Podcast',title:r.title,date:r.date||r.episode?.date,url:r.episode?.url||r.episode?.audio_url||'',text:(hits.length?hits.join('\n'):text).slice(0,6000)+(r.partial?'\n注意：此集只有部分逐字稿。':'' )});
 }
 const unique=new Map();for(const c of candidates.sort((a,b)=>String(b.date).localeCompare(String(a.date)))){const key=c.kind+':'+(c.url||c.title)+':'+c.date;if(!unique.has(key))unique.set(key,c);}
 return [...unique.values()].slice(0,12).map((s,i)=>({...s,id:'S'+(i+1)}));
}
