let watchlist=[];
const cache=new Map();
const normalize=s=>String(s||'').normalize('NFKC').replaceAll('臺','台');
const doubtful=/待確認|疑似|無法確認|未確認|未能辨識|僅(?:在)?標題|簡介提及|逐字稿未|名稱不明/;
export function setPodcastWatchlist(rows){watchlist=rows||[];}
function aliases(c){return [...new Set([c.name,c.full_name].filter(s=>s&&s.length>=2).map(s=>normalize(s).replace(/[＊*]+$/,'').trim()).filter(s=>s.length>=2))].sort((a,b)=>b.length-a.length);}
function contains(text,c){
 let value=normalize(text);for(const other of [...(c.conflicting_names||[]),...(c.code==='2303'?['台聯電']:[])])value=value.split(normalize(other)).join(' ');
 if(aliases(c).some(n=>value.includes(n)&&(!['世界','中華','大同','大成','中興'].includes(n)||new RegExp(c.code).test(value))))return true;
 return new RegExp('(?:股號|代號|股票|ticker)[：:\\s]*'+c.code+'(?!\d)','i').test(value)||new RegExp('(?<!\d)'+c.code+'\\s*(?:股票|個股|股價|公司)').test(value);
}
export function summaryPassages(answer){
 let excluded=false,inCode=false;const rows=[];
 for(const line of String(answer||'').split('\n')){
  if(/^\s*```/.test(line)){inCode=!inCode;continue;}if(inCode)continue;
  if(/^\s*#{1,6}\s/.test(line)||/^\s*\d+[.、]\s*.*(?:校正|待確認|族群|標的|總結)/.test(line)){excluded=/校正對照|重要校正|待確認|需回聽/.test(line);if(!excluded&&!doubtful.test(line))rows.push(line.replace(/^\s*#{1,6}\s+/,''));continue;}
  const text=line.replace(/\[([^\]]+)\]\([^)]*\)/g,'$1').replace(/[*_`]/g,'').trim();
  if(!excluded&&text&&!doubtful.test(text))rows.push(text);
 }
 return rows;
}
function correctedNames(record,c){
 let inCorrections=false;const originals=[];
 for(const line of String(record.answer||'').split('\n')){
  if(/^\s*#{1,6}\s/.test(line)||/^\s*\d+[.、]\s*.*(?:校正|待確認|族群|標的|總結)/.test(line)){inCorrections=/重要校正|校正對照/.test(line);continue;}
  if(!inCorrections||doubtful.test(line)||!line.includes('|'))continue;
  const cells=line.replace(/^\s*\|/,'').replace(/\|\s*$/,'').split('|').map(v=>v.replace(/[*_`「」“”]/g,'').trim());
  if(cells.length>=3&&cells[0].length>=2&&contains(cells[1],c)&&normalize(record.text).includes(normalize(cells[0])))originals.push(cells[0]);
 }return originals;
}
function mentionExcerpt(line,c,originals){const normal=normalize(line),positions=[...aliases(c),c.code,...originals].map(n=>normal.indexOf(normalize(n))).filter(at=>at>=0),start=Math.max(0,Math.min(...positions)-160);return (start?'…':'')+line.slice(start,start+500)+(line.length>start+500?'…':'');}
function compact(text){return normalize(text).replace(/^\s*(?:[-+*]|\d+[.)、])\s+/, '').replace(/[|\s*_`]/g,'');}
export function podcastMentions(record,companies=watchlist){
 if(record?.kind!=='podcast'||!record.text)return [];
 const aligned=record.state==='complete'&&!!record.answer;
 const signature=JSON.stringify(companies),key=record.owner+':'+record.id,prior=record.id?cache.get(key):null;if(prior&&prior.answer===record.answer&&prior.text===record.text&&prior.signature===signature&&prior.state===record.state)return prior.mentions;
 const passages=aligned?summaryPassages(record.answer):[],source=String(record.text);
 const mentions=companies.flatMap(c=>{const matched=passages.filter(p=>contains(p,c));const direct=contains(source,c),originals=aligned?correctedNames(record,c):[];if(!direct&&!(matched.length&&originals.length))return [];
  const evidence=[];let time='';for(const line of source.split('\n')){if(/^\[.*分鐘\]/.test(line)||/^\d{1,2}:\d{2}(?::\d{2})?[.,]\d+\s*-->/.test(line))time=line;if(contains(line,c)||originals.some(n=>normalize(line).includes(normalize(n))))evidence.push({time,text:mentionExcerpt(line,c,originals)});}
  return [{code:c.code,name:c.name,status:matched.length?(direct?'原稿與 AI 段落對齊':'AI 名稱校正，請核對原稿'):'逐字稿初步比對，尚未對齊 AI',passages:matched,evidence}];
 });
 if(record.id){if(cache.size>=100)cache.clear();cache.set(key,{answer:record.answer,text:record.text,state:record.state,signature,mentions});}return mentions;
}
export function podcastMentionIndex(records,companies=watchlist,selected=''){
 const dates=new Map(),episodes=new Map();
 for(const record of [...records].sort((a,b)=>String(b.updated_at).localeCompare(String(a.updated_at)))){
  const date=record.date||record.episode?.date;if(!/^\d{4}-\d{2}-\d{2}$/.test(date||''))continue;
  const stocks=podcastMentions(record,companies).filter(c=>!selected||c.code===selected);if(!stocks.length)continue;
  const episodeId=record.episode?.id||String(record.id||'').replace(/^podcast:/,'');
  const key=date+':'+(episodeId||normalize(record.title));
  let entry=episodes.get(key);
  if(!entry){entry={record,stocks:[]};episodes.set(key,entry);if(!dates.has(date))dates.set(date,[]);dates.get(date).push(entry);}
  for(const stock of stocks){
   const existing=entry.stocks.find(item=>item.code===stock.code);
   if(!existing)entry.stocks.push({...stock,sourceRecord:record});
   else{
    existing.passages=[...new Set([...existing.passages,...stock.passages])];
    existing.evidence=[...new Map([...existing.evidence,...stock.evidence].map(item=>[item.time+'|'+item.text,item])).values()];
   }
  }
 }
 return dates;
}
export function decoratePodcastSummary(body,record,focusCode=''){
 const stocks=podcastMentions({...record,kind:'podcast',state:'complete'});if(!stocks.length)return;
 const legend=document.createElement('small');legend.className='podcast-highlight-legend';legend.textContent='★ 金色為追蹤股；紫色為 AI 名稱校正，請核對原稿。點個股定位，重複點擊切換下一處。';
 for(const block of body.querySelectorAll('p,li,tr,h1,h2,h3,h4,h5,h6')){
  if(block.tagName==='LI'&&block.querySelector('p'))continue;
  const text=block.textContent,eligible=stocks.filter(c=>contains(text,watchlist.find(w=>w.code===c.code))&&c.passages.some(p=>compact(text).includes(compact(p))||compact(p).includes(compact(text))));
  if(doubtful.test(text)||!eligible.length)continue;
  const walker=document.createTreeWalker(block,4),nodes=[];while(walker.nextNode())if(!walker.currentNode.parentElement.closest('code,pre,mark'))nodes.push(walker.currentNode);
  for(const node of nodes){const value=node.textContent,normal=normalize(value),hits=[];
   for(const stock of eligible){const c=watchlist.find(c=>c.code===stock.code);if(!contains(value,c))continue;for(const name of [...aliases(c),...(contains(value,{...c,name:'',full_name:''})?[c.code]:[])]){let at=0;while((at=normal.indexOf(name,at))!==-1){const end=at+name.length;if(name===c.code&&(/\d/.test(normal[at-1]||'')||/\d/.test(normal[end]||''))){at=end;continue;}if(!hits.some(h=>at<h.end&&end>h.at))hits.push({at,end,stock});at=end;}}}
   if(!hits.length)continue;hits.sort((a,b)=>a.at-b.at);const fragment=document.createDocumentFragment();let at=0;for(const hit of hits){fragment.append(value.slice(at,hit.at));const mark=document.createElement('mark');mark.className='podcast-stock-mention'+(hit.stock.status.startsWith('AI')?' podcast-stock-corrected':'');mark.dataset.podcastStock=hit.stock.code;mark.title='★ 已追蹤 '+hit.stock.code+' '+hit.stock.name+' · '+hit.stock.status;mark.setAttribute('aria-label',hit.stock.code+' '+hit.stock.name);mark.textContent=value.slice(hit.at,hit.end);fragment.append(mark);at=hit.end;}fragment.append(value.slice(at));node.replaceWith(fragment);block.classList.add('podcast-mentioned-passage');
  }
 }
 // A transcript mention remains individually reachable even when the summary omits it.
 for(const stock of stocks){if(body.querySelector(`[data-podcast-stock="${stock.code}"]`))continue;const section=document.createElement('section');section.className='podcast-source-location';const title=document.createElement('h4');title.textContent=stock.code+' '+stock.name+' · 原稿定位（尚無可定位的 AI 段落）';section.append(title);for(const evidence of stock.evidence){const quote=document.createElement('blockquote'),label=document.createElement('mark'),time=document.createElement('small'),text=document.createElement('p');label.className='podcast-stock-mention';label.dataset.podcastStock=stock.code;label.dataset.mentionSource='transcript';label.textContent=stock.code+' '+stock.name;time.textContent=evidence.time||'原稿未提供時間';text.textContent=evidence.text;quote.append(label,time,text);section.append(quote);}body.append(section);}
 const nav=document.createElement('nav');nav.className='podcast-stock-locations';nav.setAttribute('aria-label','本集追蹤股段落定位');const status=document.createElement('small');status.setAttribute('role','status');const indices=new Map();
 const locate=code=>{const targets=[...body.querySelectorAll(`[data-podcast-stock="${code}"]`)];if(!targets.length)return;const index=((indices.get(code)??-1)+1)%targets.length;indices.set(code,index);body.querySelectorAll('[data-podcast-stock]').forEach(m=>{m.classList.toggle('podcast-stock-focused',m.dataset.podcastStock===code);m.classList.remove('podcast-stock-current');});nav.querySelectorAll('button').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.stockCode===code)));const target=targets[index];target.classList.add('podcast-stock-current');for(let parent=target.parentElement;parent&&parent!==body;parent=parent.parentElement)if(parent.tagName==='DETAILS')parent.open=true;status.textContent=stocks.find(c=>c.code===code).name+' · 第 '+(index+1)+'／'+targets.length+' 處'+(target.dataset.mentionSource?' · 原稿片段':' · AI 總結');target.scrollIntoView({block:'center'});};
 for(const stock of stocks){const count=body.querySelectorAll(`[data-podcast-stock="${stock.code}"]`).length;if(!count)continue;const button=document.createElement('button');button.type='button';button.dataset.stockCode=stock.code;button.setAttribute('aria-pressed','false');button.textContent=stock.code+' '+stock.name+' · '+count+' 處';button.onclick=()=>locate(stock.code);nav.append(button);}nav.append(status);body.prepend(nav);body.prepend(legend);
 if(stocks.some(c=>c.code===focusCode))locate(focusCode);
}
