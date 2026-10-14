import {api} from './api.js';
import {isUS} from '../shared/markets.js';
import {substackMentions,substackPrompt,substackChunks} from '../shared/substack.js';
import {currentAISettings,requestAI} from './local-ai.js';
import {requireAISession} from './ai-auth.js';
import {companyMode} from './ai-privacy.js';
import {runResultJob,resultRecords,openResultsCenter} from './ai-results.js';

const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let importOpen=false,draftURL='',draftTitle='',importCandidates=[],importWarning='',importBusy=false,progressTimer=null,progressLoading=false;
let owner=null,authors=[],articles=[],loading=false,error='',message='',authorFilter='',stockFilter='',dateOnly=false,query='',limit=30,context={},onChange=()=>{},loaded=false,generation=0;
export function substackDateArticles(date,companies=[],selected=''){
 if(context.market!=='US'||context.flags?.['news_calendar.substack']===false)return [];
 const codes=new Set(companies.filter(c=>isUS(c.code)&&(!selected||selected===c.code)).map(c=>c.code));
 return articles.filter(a=>a.date===date&&(!authorFilter||a.author_id===authorFilter)&&(a.mentions||[]).some(c=>codes.has(c.code)));
}
function card(a,tracked){
 const codes=new Set(tracked.map(c=>c.code));
 return `<article class="substack-card"><strong>${esc(a.title)}</strong><small>${esc(a.author_title)} · ${esc(a.date)} 美東 · ${a.access==='public'?'公開內文':'公開預覽／部分內容'}</small><div class="stock-actions">${(a.mentions||[]).map(c=>`<button data-substack-open="${esc(a.id)}" data-substack-code="${esc(c.code)}">${codes.has(c.code)?'★ ':''}${esc(c.code.replace('US:',''))} ${esc(c.name)}</button>`).join('')}</div><div class="stock-actions"><button data-substack-open="${esc(a.id)}">查看標的與作者看法</button><a href="${esc(a.url)}" target="_blank" rel="noopener noreferrer">原文</a></div></article>`;
}
export function substackDayPanel(date,companies,selected){
 const rows=substackDateArticles(date,companies,selected);
 return rows.length?`<section class="substack-day"><h3>★ Substack 提及追蹤股（${rows.length} 篇）</h3>${rows.map(a=>card(a,companies)).join('')}</section>`:'';
}
function reset(next){clearTimeout(progressTimer);progressTimer=null;progressLoading=false;importOpen=false;draftURL='';draftTitle='';importCandidates=[];importWarning='';importBusy=false;owner=next;generation++;authors=[];articles=[];loaded=false;loading=false;error='';message='';authorFilter='';stockFilter='';query='';limit=30;document.querySelector('#substack-article-dialog')?.closest('.modal-backdrop')?.remove();}
async function load(){
 if(loading||!owner)return;loading=true;error='';const who=owner,version=generation;onChange();
 try{const data=await api('/substack/authors');let rows=[],offset=0;
  while(true){const page=await api('/substack/articles?offset='+offset);rows.push(...page.articles);if(who!==owner||version!==generation)return;if(!page.has_more)break;if(page.next_offset<=offset)throw Error('文章分頁未前進');offset=page.next_offset;}
  if(who!==owner||version!==generation)return;authors=data.authors;articles=[...new Map(rows.map(a=>[a.id,a])).values()];loaded=true;
 }catch(e){if(who===owner&&version===generation)error=e.message;}finally{if(who===owner&&version===generation){loading=false;onChange();}}
}
export function setSubstackContext(options){context=options;if(owner!==(options.owner||null))reset(options.owner||null);}
function importControls(){
 return `<button class="substack-import" data-substack-import-open ${!owner?'disabled':''}>匯入 Substack 作者的全部文章</button><details class="substack-import" ${importOpen?'open':''}><summary>新增作者與匯入設定</summary><p>貼上作者個人頁、刊物首頁或文章連結。匯入整個刊物的全部歷史文章，不受目前日期、個股或搜尋篩選限制。付費文章僅收錄公開預覽；匯入不會自動呼叫 AI。</p><form data-substack-import><label>Substack 作者／刊物網址<input name="url" type="url" required ${importBusy?'disabled':''} value="${esc(draftURL)}" placeholder="https://substack.com/@作者 或 https://刊物.substack.com"></label><label>作者顯示名稱（選填）<input name="title" maxlength="500" ${importBusy?'disabled':''} value="${esc(draftTitle)}" placeholder="留空使用刊物名稱"></label><button ${!owner||importBusy?'disabled':''}>${importBusy?'處理中…':'解析作者／刊物'}</button></form><p data-substack-import-status role="status">${esc(importWarning)}</p>${importCandidates.map((c,i)=>`<article class="substack-import-candidate"><strong>${esc(c.title)}</strong><small>${esc(c.url)}</small><button data-substack-import-candidate="${i}" ${importBusy?'disabled':''}>匯入此刊物的全部文章</button></article>`).join('')}</details>`;
}
function authorProgress(a){
 const count=a.article_count??articles.filter(row=>row.author_id===a.id).length,full=a.public_count??articles.filter(row=>row.author_id===a.id&&row.access==='public').length;
 const status=a.last_error?'匯入失敗／待重試':a.archive_complete?'全部歷史文章匯入完成':count?'正在分批匯入，背景會自動續抓':'等待背景匯入';
 return `<article class="substack-author-progress"><strong>${esc(a.title)}</strong><p role="status">${status} · 已匯入 ${count} 篇${a.archive_complete?'':'（總篇數待匯入完成後確認）'}</p><small>公開內文 ${full} 篇 · 預覽／部分內容 ${Math.max(0,count-full)} 篇${a.updated_at?' · 最後更新 '+esc(a.updated_at):''}</small>${a.last_error?`<p class="notice">${esc(a.last_error)}</p>`:''}<button data-substack-author-refresh="${esc(a.id)}" ${!owner?'disabled':''}>${a.last_error?'重試匯入':a.archive_complete?'更新此作者的新文章':'繼續匯入全部文章'}</button></article>`;
}
async function refreshAuthor(id=''){
 const who=owner,version=generation;try{const r=await api('/substack/refresh',{body:{author_id:id}});if(who!==owner||version!==generation)return;message=r.message;error='';await load();}catch(e){if(who===owner&&version===generation){error=e.message;onChange();}}
}
function scheduleProgress(){
 const active=owner&&context.market==='US'&&context.flags?.['news_calendar.substack']!==false&&authors.some(a=>!a.archive_complete&&!a.last_error);
 if(!active){clearTimeout(progressTimer);progressTimer=null;return;}
 if(progressTimer||progressLoading||loading)return;
 const who=owner,version=generation;
 progressTimer=setTimeout(async()=>{progressTimer=null;if(who!==owner||version!==generation)return;
  if(document.visibilityState==='hidden'){scheduleProgress();return;}
  progressLoading=true;try{const data=await api('/substack/authors');if(who!==owner||version!==generation)return;
   const changed=JSON.stringify(data.authors)!==JSON.stringify(authors);if(changed){authors=data.authors;await load();}
  }catch(e){if(who===owner&&version===generation){error='匯入進度暫時無法更新：'+e.message;onChange();}}finally{if(who===owner&&version===generation){progressLoading=false;scheduleProgress();}}
 },30000);
}
export function mountSubstack(host,options,changed){
 setSubstackContext(options);onChange=changed;
 if(!host)return;
 if(options.market!=='US'||options.flags?.['news_calendar.substack']===false){host.hidden=true;scheduleProgress();return;}host.hidden=false;
 const rows=articles.filter(a=>(!authorFilter||a.author_id===authorFilter)&&(!dateOnly||a.date===options.date)&&(!(options.selected||stockFilter)||(a.mentions||[]).some(c=>c.code===(options.selected||stockFilter)))&&(!query||[a.title,a.author_title,...(a.mentions||[]).map(c=>c.name+' '+c.code)].join(' ').toLowerCase().includes(query.toLowerCase())));
 const stocks=[...new Map(articles.filter(a=>!authorFilter||a.author_id===authorFilter).flatMap(a=>a.mentions||[]).map(c=>[c.code,c])).values()].sort((a,b)=>a.code.localeCompare(b.code));
 host.innerHTML=`<section class="substack-panel"><div class="modal-heading"><h2>Substack 作者與美股觀點</h2><button data-substack-reload ${loading||!owner?'disabled':''}>${loading?'載入中…':'重新載入文章'}</button></div><p>★ 為你追蹤的美股。原文提及與作者立場分開呈現；匯入不消耗 AI Token，生成整理使用你的 AI 設定。</p><p role="status">${esc(error||message||(!owner?'請先登入以查看作者文章':`${articles.length} 篇已匯入文章`))}</p>${options.flags?.['news_calendar.substack_import']===false?'':importControls()}<details class="substack-progress" ${authors.some(a=>!a.archive_complete||a.last_error)?'open':''}><summary>作者匯入進度（${authors.length} 位）</summary>${authors.map(authorProgress).join('')||'<p>尚無作者資料。</p>'}<small>匯入途中可以關閉網站。背景持續保存文章，開啟此頁時每 30 秒更新進度；沒有提供總篇數時不顯示估算百分比。</small></details><div class="substack-filters"><label>作者<select data-substack-author><option value="">全部作者</option>${authors.map(a=>`<option value="${esc(a.id)}" ${a.id===authorFilter?'selected':''}>${esc(a.title)}</option>`).join('')}</select></label><label>標的<select data-substack-stock ${options.selected?'disabled':''}><option value="">全部標的</option>${stocks.map(c=>`<option value="${esc(c.code)}" ${c.code===(options.selected||stockFilter)?'selected':''}>${esc(c.code.replace('US:',''))} ${esc(c.name)}</option>`).join('')}</select></label><label>標題／標的搜尋<input data-substack-search value="${esc(query)}" maxlength="100" placeholder="例如 NVDA、輝達"></label><label class="ai-check"><input type="checkbox" data-substack-date ${dateOnly?'checked':''}>只看選定日期 ${esc(options.date)}</label></div><div class="stock-actions"><button data-substack-refresh ${!owner?'disabled':''}>${authorFilter?'更新選定作者的文章':'更新全部作者的文章'}</button></div><p>顯示 ${Math.min(limit,rows.length)}／${rows.length} 篇${options.selected?' · 已套用左側選定個股':''}</p><div class="substack-articles">${rows.slice(0,limit).map(a=>card(a,options.companies)).join('')||'<p class="empty">尚無符合條件的文章。可更新文章或調整作者／日期／標的篩選。</p>'}</div>${rows.length>limit?'<button data-substack-more>顯示更多文章</button>':''}</section>`;
 host.querySelector('[data-substack-author]').onchange=e=>{authorFilter=e.target.value;stockFilter='';limit=30;onChange();};
 host.querySelector('[data-substack-stock]').onchange=e=>{stockFilter=e.target.value;limit=30;onChange();};
 host.querySelector('[data-substack-date]').onchange=e=>{dateOnly=e.target.checked;limit=30;onChange();};
 host.querySelector('[data-substack-search]').onchange=e=>{query=e.target.value.trim();limit=30;onChange();};
 host.querySelector('[data-substack-more]')?.addEventListener('click',()=>{limit+=30;onChange();});
 host.querySelector('[data-substack-reload]').onclick=()=>void load();
 host.querySelector('[data-substack-refresh]').onclick=e=>{e.target.disabled=true;void refreshAuthor(authorFilter);};
 host.querySelectorAll('[data-substack-author-refresh]').forEach(b=>b.onclick=()=>{b.disabled=true;void refreshAuthor(b.dataset.substackAuthorRefresh);});
 host.querySelector('[data-substack-import-open]')?.addEventListener('click',()=>{importOpen=true;onChange();host.querySelector('[name=url]')?.focus();});
 const importDetails=host.querySelector('details.substack-import');if(importDetails)importDetails.ontoggle=()=>{importOpen=importDetails.open;};
 const form=host.querySelector('[data-substack-import]');
 if(form){form.querySelector('[name=url]').oninput=e=>{draftURL=e.target.value;importCandidates=[];importWarning='網址已變更，請重新解析作者／刊物';host.querySelectorAll('.substack-import-candidate').forEach(el=>el.remove());host.querySelector('[data-substack-import-status]').textContent=importWarning;};form.querySelector('[name=title]').oninput=e=>{draftTitle=e.target.value;};
  form.onsubmit=async e=>{e.preventDefault();if(importBusy)return;const who=owner,version=generation;draftURL=form.querySelector('[name=url]').value;draftTitle=form.querySelector('[name=title]').value;importOpen=true;importBusy=true;importWarning='正在解析作者與刊物…';importCandidates=[];onChange();
   try{const r=await api('/substack/resolve',{body:{url:draftURL}});if(who!==owner||version!==generation)return;importCandidates=r.candidates;importWarning=r.warning||'請核對刊物後，點下方按鈕匯入全部歷史文章。';}catch(e){if(who===owner&&version===generation)importWarning=e.message;}finally{if(who===owner&&version===generation){importBusy=false;onChange();}}
  };
 }
 host.querySelectorAll('[data-substack-import-candidate]').forEach(b=>b.onclick=async()=>{if(importBusy)return;const candidate=importCandidates[Number(b.dataset.substackImportCandidate)],who=owner,version=generation;if(!candidate)return;importBusy=true;onChange();
  try{const r=await api('/substack/authors',{body:{url:candidate.url,title:draftTitle.trim()||candidate.title}});if(who!==owner||version!==generation)return;message=r.message+(r.warning?'：'+r.warning:'');error='';authorFilter=r.author?.id||new URL(candidate.url).hostname.split('.')[0];dateOnly=false;stockFilter='';query='';limit=30;importCandidates=[];importOpen=!!r.warning;await load();}catch(e){if(who===owner&&version===generation)importWarning=e.message;}finally{if(who===owner&&version===generation){importBusy=false;onChange();}}
 });
 if(!loaded&&!loading&&!error&&owner)queueMicrotask(()=>void load());scheduleProgress();
}
export function bindSubstackActions(root){root.querySelectorAll('[data-substack-open]').forEach(b=>b.onclick=()=>void openArticle(b.dataset.substackOpen,b.dataset.substackCode));}
async function openArticle(id,focus=''){
 const who=owner;if(!who)return;const version=generation;
 document.querySelector('#substack-article-dialog')?.closest('.modal-backdrop')?.remove();
 const wrap=document.createElement('div');wrap.className='modal-backdrop';wrap.innerHTML='<section id="substack-article-dialog" class="summary-dialog ai-dialog" role="dialog" aria-modal="true" aria-label="Substack 作者文章"><div class="modal-heading"><h2>Substack 文章</h2><button data-substack-close aria-label="關閉文章">×</button></div><p data-substack-status role="status">正在取得原文…</p><div data-substack-content></div></section>';document.body.append(wrap);document.body.classList.add('modal-open');
 const close=()=>{wrap.remove();document.body.classList.toggle('modal-open',!!document.querySelector('.modal-backdrop'));};wrap.querySelector('[data-substack-close]').onclick=close;wrap.onkeydown=e=>{if(e.key==='Escape')close();};
 const status=wrap.querySelector('[data-substack-status]');
 try{const {article:a}=await api('/substack/article?id='+encodeURIComponent(id));if(who!==owner||version!==generation||!wrap.isConnected)return;
  const matches=substackMentions(a.text,[...new Map([...(a.mentions||[]),...context.companies].map(c=>[c.code,c])).values()]),recordId='substack:'+a.id,saved=resultRecords(who).find(r=>r.id===recordId&&r.answer);
  status.textContent=a.access==='public'?'已取得公開內文':'僅取得公開預覽；整理不包含付費牆後內容';
  const body=wrap.querySelector('[data-substack-content]');body.innerHTML=`<h3>${esc(a.title)}</h3><p>${esc(a.author_title)} · ${esc(a.date)} 美東</p><a href="${esc(a.url)}" target="_blank" rel="noopener noreferrer">開啟原文</a><p>原文提及 ${matches.length} 檔標的；立場需查看 AI 整理及原文。</p><nav class="stock-actions">${matches.map(c=>`<button data-substack-locate="${esc(c.code)}">${esc(c.code.replace('US:',''))} ${esc(c.name)}</button>`).join('')}</nav><div class="stock-actions"><button data-substack-ai ${a.text?'':'disabled'}>${saved?'重新生成作者觀點（會呼叫 AI）':'生成作者標的與觀點'}</button>${saved?'<button data-substack-result>查看已保存的作者觀點</button>':''}</div>${matches.map(c=>`<details data-substack-evidence="${esc(c.code)}" ${c.code===focus?'open':''}><summary>${esc(c.code)} ${esc(c.name)} · 原文證據 · ${esc(c.status||'原文提及')}</summary>${c.evidence.map(e=>`<blockquote><small>段落 ${e.paragraph}</small><p>${esc(e.text)}</p></blockquote>`).join('')}</details>`).join('')}<details><summary>查看已取得原文</summary><p class="article-summary">${esc(a.text)}</p></details>`;
  body.querySelector('[data-substack-result]')?.addEventListener('click',()=>openResultsCenter(recordId,{focusCode:focus}));
  body.querySelectorAll('[data-substack-locate]').forEach(b=>b.onclick=()=>{const el=[...body.querySelectorAll('[data-substack-evidence]')].find(el=>el.dataset.substackEvidence===b.dataset.substackLocate);if(el){el.open=true;el.scrollIntoView({block:'center'});}});
  body.querySelector('[data-substack-ai]').onclick=async e=>{
   e.target.disabled=true;try{await requireAISession();if(who!==owner)throw Error('登入帳號已變更');const config={...currentAISettings()},companies=[...context.companies];
    const chunks=substackChunks(a.text);
    await runResultJob({id:recordId,title:a.title,kind:'substack',date:a.date,local_only:companyMode(config),episode:{id:a.id,title:a.title,date:a.date,url:a.url,channel_id:a.author_id,channel_name:a.author_title}},async(signal,progress)=>{
     const answers=[];for(let i=0;i<chunks.length;i++){progress(`整理作者觀點 ${i+1}／${chunks.length} 段`);answers.push((chunks.length>1?`## 原文片段 ${i+1}／${chunks.length}\n\n`:'')+await requestAI(config,substackPrompt({...a,...chunks[i]},[...new Map([...(a.mentions||[]),...companies].map(c=>[c.code,c])).values()]),{signal:AbortSignal.any([signal,AbortSignal.timeout(120000)])}));}
     return {answer:answers.join('\n\n'),text:a.text,partial:a.access!=='public',failures:a.access==='public'?[]:['僅依公開預覽分析，不含付費牆後內容']};
    });if(who===owner&&wrap.isConnected){status.textContent='作者觀點整理完成，已保存至你的 AI 成果中心';openResultsCenter(recordId,{focusCode:focus});}
   }catch(e){status.textContent=e.message;}finally{if(wrap.isConnected)e.target.disabled=false;}
  };
 }catch(e){if(wrap.isConnected)status.textContent=e.message;}
}
