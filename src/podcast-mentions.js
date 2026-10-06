let watchlist=[];
const cache=new Map();
const normalize=s=>String(s||'').normalize('NFKC').replaceAll('臺','台');
const doubtful=/待確認|疑似|無法確認|未確認|未能辨識|僅(?:在)?標題|簡介提及|逐字稿未|名稱不明/;
export function setPodcastWatchlist(rows){watchlist=rows||[];}
function aliases(c){return [...new Set([c.name,c.full_name].filter(s=>s&&s.length>=2).map(normalize))].sort((a,b)=>b.length-a.length);}
function contains(text,c){
 let value=normalize(text);for(const other of [...(c.conflicting_names||[]),...(c.code==='2303'?['台聯電']:[])])value=value.split(normalize(other)).join(' ');
 if(aliases(c).some(n=>value.includes(n)&&(!['世界','中華','大同','大成','中興'].includes(n)||new RegExp(c.code).test(value))))return true;
 return new RegExp('(?:股號|代號|股票|ticker)[：:\\s]*'+c.code+'(?!\\d)','i').test(value)||new RegExp('(?<!\\d)'+c.code+'\\s*(?:股票|個股|股價|公司)').test(value);
}
export function summaryPassages(answer){
 let excluded=false,inCode=false;const rows=[];
 for(const line of String(answer||'').split('\n')){
  if(/^\s*```/.test(line)){inCode=!inCode;continue;}if(inCode)continue;
  if(/^\s*#{1,6}\s/.test(line)||/^\s*\d+[.、]\s*.*(?:校正|待確認|族群|標的|總結)/.test(line)){excluded=/校正對照|重要校正|待確認|需回聽/.test(line);continue;}
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
export function podcastMentions(record,companies=watchlist){
 if(record?.kind!=='podcast'||!record.text)return [];
 const aligned=record.state==='complete'&&!!record.answer;
 const signature=JSON.stringify(companies),key=record.owner+':'+record.id,prior=record.id?cache.get(key):null;if(prior&&prior.answer===record.answer&&prior.text===record.text&&prior.signature===signature&&prior.state===record.state)return prior.mentions;
 const passages=aligned?summaryPassages(record.answer):[],source=String(record.text);
 const mentions=companies.flatMap(c=>{const matched=passages.filter(p=>contains(p,c));const direct=contains(source,c),originals=aligned?correctedNames(record,c):[];if(!direct&&!(matched.length&&originals.length))return [];
  const evidence=[];let time='';for(const line of source.split('\n')){if(/^\[.*分鐘\]/.test(line)||/^\d{1,2}:\d{2}(?::\d{2})?[.,]\d+\s*-->/.test(line))time=line;if(contains(line,c)||originals.some(n=>normalize(line).includes(normalize(n))))evidence.push({time,text:line.slice(0,500)});}
  return [{code:c.code,name:c.name,status:matched.length?(direct?'原稿與 AI 段落對齊':'AI 名稱校正，請核對原稿'):'逐字稿初步比對，尚未對齊 AI',passages:matched,evidence}];
 });
 if(record.id){if(cache.size>=100)cache.clear();cache.set(key,{answer:record.answer,text:record.text,state:record.state,signature,mentions});}return mentions;
}
export function podcastMentionIndex(records,companies=watchlist,selected=''){
 const dates=new Map(),seen=new Set();for(const record of [...records].sort((a,b)=>String(b.updated_at).localeCompare(String(a.updated_at)))){
  const date=record.date||record.episode?.date;if(!/^\d{4}-\d{2}-\d{2}$/.test(date||''))continue;
  const stocks=podcastMentions(record,companies).filter(c=>!selected||c.code===selected);if(!stocks.length)continue;
  const key=date+':'+record.title;if(seen.has(key))continue;seen.add(key);if(!dates.has(date))dates.set(date,[]);dates.get(date).push({record,stocks});
 }return dates;
}
export function decoratePodcastSummary(body,record,focusCode=''){
 const stocks=podcastMentions({...record,kind:'podcast',state:'complete'});if(!stocks.length)return;
 const legend=document.createElement('small');legend.className='podcast-highlight-legend';legend.textContent='★ 金色為追蹤股；紫色為 AI 名稱校正，請核對原稿。';body.prepend(legend);
 for(const block of body.querySelectorAll('p,li,tr')){
  if(block.tagName==='LI'&&block.querySelector('p'))continue;
  const text=block.textContent;if(doubtful.test(text)||!stocks.some(c=>c.passages.some(p=>normalize(p.replace(/\|/g,'')).replace(/\s/g,'')===normalize(text).replace(/\s/g,'')||normalize(p).includes(normalize(text.trim())))))continue;
  const walker=document.createTreeWalker(block,4),nodes=[];while(walker.nextNode())if(!walker.currentNode.parentElement.closest('a,code,pre,mark'))nodes.push(walker.currentNode);
  for(const node of nodes){const value=node.textContent,normal=normalize(value),hits=[];
   for(const stock of stocks){const c=watchlist.find(c=>c.code===stock.code);for(const name of [...aliases(c),...(contains(value,{...c,name:'',full_name:''})?[c.code]:[])]){let at=0;while((at=normal.indexOf(name,at))!==-1){const end=at+name.length;if(name===c.code&&(/\d/.test(normal[at-1]||'')||/\d/.test(normal[end]||''))){at=end;continue;}if(!hits.some(h=>at<h.end&&end>h.at))hits.push({at,end,stock});at=end;}}}
   if(!hits.length)continue;hits.sort((a,b)=>a.at-b.at);const fragment=document.createDocumentFragment();let at=0;for(const hit of hits){fragment.append(value.slice(at,hit.at));const mark=document.createElement('mark');mark.className='podcast-stock-mention'+(hit.stock.status.startsWith('AI')?' podcast-stock-corrected':'');mark.dataset.podcastStock=hit.stock.code;mark.title='★ 已追蹤 '+hit.stock.code+' '+hit.stock.name+' · '+hit.stock.status;mark.textContent=value.slice(hit.at,hit.end);fragment.append(mark);at=hit.end;}fragment.append(value.slice(at));node.replaceWith(fragment);block.classList.add('podcast-mentioned-passage');
  }
 }
 if(/^\d{4,6}$/.test(focusCode))body.querySelector(`[data-podcast-stock="${focusCode}"]`)?.scrollIntoView({block:'center'});
}
