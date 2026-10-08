export function findAssistantCompany(question,companies,selected=''){
 const normalize=s=>String(s||'').normalize('NFKC').replaceAll('臺','台').toLowerCase();
 const q=normalize(question);
 const found=companies.filter(c=>new RegExp('(^|[^0-9])'+c.code+'([^0-9]|$)').test(q)||[c.name,c.full_name].filter(Boolean).some(n=>q.includes(normalize(n).replace(/[＊*]+$/,''))));
 return found.length?found:selected?companies.filter(c=>c.code===selected):[];
}
export function assistantSources(question,{companies=[],selected='',news=[],records=[]}={}){
 const stocks=findAssistantCompany(question,companies,selected),codes=new Set(stocks.map(s=>s.code));
 let topic=question;
 for(const c of stocks)for(const name of [c.full_name,c.name?.replace(/[＊*]+$/,''),c.code].filter(Boolean))topic=topic.replaceAll(name,' ');
 const keywords=[...new Set(topic.split(/整理|查詢|搜尋|新聞|近期|最近|歷史|既有|所有|全部|相關|內容|有哪些|有什麼|什麼|請問|幫我|關於|分析|消息|事件|Podcast|podcast|提及|觀察|[\s，。？、：:,.?!]+/).map(s=>s.replace(/^[的與和及]+|[的與和及]+$/g,'')).filter(s=>s.length>=2))];
 const dates=[...question.matchAll(/(?:(\d{4})[年/-])?(\d{1,2})月|\b(\d{4})-(\d{2})(?:-(\d{2}))?\b/g)].map(m=>m[3]?m[3]+'-'+m[4]+(m[5]?'-'+m[5]:''):(m[1]?m[1]+'-':'')+m[2].padStart(2,'0'));
 const relevance=s=>keywords.reduce((score,k)=>score+(s.title.includes(k)?3:s.text.includes(k)?1:0),0)+dates.reduce((score,d)=>score+((d.length===2?String(s.date).slice(5,7)===d:String(s.date).startsWith(d))?10:0),0);
 const terms=[...new Set(question.match(/[a-zA-Z0-9]+|[\u4e00-\u9fff]{2,}/g)||[])];
 const match=text=>stocks.some(c=>text.includes(c.name.replace(/[＊*]+$/,''))||text.includes(c.code))||terms.some(t=>text.includes(t));
 const candidates=[];
 for(const n of news){if(codes.size?!codes.has(n.company_code):!match(n.title+' '+(n.article_summary||'')))continue;candidates.push({kind:'新聞',title:n.title,date:n.news_date||n.published_at,url:n.article_url||n.url,text:[n.title,n.article_summary||n.summary||n.description||'僅有標題，未取得新聞全文'].join('\n')});}
 for(const r of records){if(r.kind!=='podcast'||!r.text&&!r.answer)continue;const text=[r.text||'',r.answer||''].join('\n');if(!match(text))continue;
 const lines=text.split('\n'),hits=lines.flatMap((line,i)=>match(line)?[...lines.slice(Math.max(0,i-1),i+2)]:[]);
 candidates.push({kind:'Podcast',title:r.title,date:r.date||r.episode?.date,url:r.episode?.url||r.episode?.audio_url||'',text:(hits.length?hits.join('\n'):text).slice(0,6000)+(r.partial?'\n注意：此集只有部分逐字稿。':'' )});
 }
 const unique=new Map();for(const c of candidates.sort((a,b)=>relevance(b)-relevance(a)||String(b.date).localeCompare(String(a.date)))){const key=c.kind+':'+(c.url||c.title)+':'+c.date;if(!unique.has(key))unique.set(key,c);}
 return [...unique.values()].slice(0,12).map((s,i)=>({...s,id:'S'+(i+1)}));
}
