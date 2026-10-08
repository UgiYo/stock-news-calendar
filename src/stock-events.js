import {api} from './api.js';
import {currentAISettings,aiRequest,requestAI,readFullNews,openAIWindow} from './local-ai.js';
import {runResultJob,resultRecords,resultOwner,saveResult} from './ai-results.js';
import {syncAccountResults} from './result-sync.js';
import {requireAISession} from './ai-auth.js';
import {companyMode} from './ai-privacy.js';
import {eventPrompt,completedDay} from '../shared/stock-movements.js';
import {showMarkdown} from './markdown-preview.js';
import {safeURL} from './utils.js';
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const pct=n=>Number.isFinite(n)?`${n>=0?'+':''}${n.toFixed(2)}%`:'資料不足';
export function movementSummary(m){return m?.windows?.map(w=>`${w.days} 日 ${pct(w.change)}`).join(' · ')||m?.reason||'等待行情';}
export function movementPanel(m){return `<div class="movement-metrics">${(m?.windows||[]).map(w=>`<article><strong>${w.days} 日 ${pct(w.change)}</strong><p>${esc(w.from||'資料不足')}～${esc(w.to||'')} ${w.triggered?'· 符合異動門檻':''}</p><small>${w.reason?esc(w.reason):`相對加權指數 ${w.excess==null?'資料不足':w.excess.toFixed(2)+' 百分點'} · 量能 ${w.volumeRatio==null?'資料不足':w.volumeRatio.toFixed(2)+' 倍'}`}</small></article>`).join('')}</div><small>${esc(m?.priceWarning||'')}</small>${m?.adjustmentRisk?'<p class="notice">價格出現極大跳動，需先確認除權息、減資或分割，不能直接歸因新聞。</p>':''}`;}
let active=null;
export function closeStockEventOnOwnerChange(owner){if(active&&active.owner!==owner)active.close();}
export function openStockEvent({code,date=completedDay(),company={code,name:''},owner=resultOwner(),onDate=()=>{}}){
 active?.close();if(owner==='guest')return;
 const focus=document.activeElement,wrap=document.createElement('div');wrap.className='modal-backdrop';
 wrap.innerHTML='<section id="stock-event-dialog" class="summary-dialog stock-event-dialog" role="dialog" aria-modal="true" aria-labelledby="stock-event-title"></section>';
 document.body.append(wrap);document.body.classList.add('modal-open');const dialog=wrap.querySelector('section');
 const view={owner,code,date:date>completedDay()?completedDay():date,company,lookback:45,data:null,message:'讀取行情與回溯新聞…',busy:false,generating:false,answer:'',version:0};
 const current=()=>active===view&&owner===resultOwner()&&wrap.isConnected;
 view.close=()=>{view.version++;wrap.remove();if(active===view)active=null;document.body.classList.toggle('modal-open',!!document.querySelector('.modal-backdrop'));focus?.isConnected&&focus.focus();};active=view;
 const status=message=>{if(current()){view.message=message;const node=dialog.querySelector('[data-event-status]');if(node)node.textContent=message;}};
 function draw(){if(!current())return;const data=view.data,rows=data?.news||[];
  dialog.innerHTML=`<div class="modal-heading"><h2 id="stock-event-title">${esc(view.company.code)} ${esc(view.company.name)} · 異動事件追查</h2><button data-event-close aria-label="關閉異動追查">×</button></div><div class="stock-actions"><label>分析截止日 <input type="date" data-event-date value="${view.date}" max="${completedDay()}" ${view.generating?'disabled':''}></label><label>回溯範圍 <select data-event-lookback ${view.generating?'disabled':''}><option value="30" ${view.lookback===30?'selected':''}>30 天</option><option value="45" ${view.lookback===45?'selected':''}>45 天</option></select></label><button data-event-refresh ${view.busy||view.generating?'disabled':''}>${view.busy?'更新中…':'更新行情與新聞'}</button></div><p role="status" data-event-status>${esc(view.message)}</p>${data?`<p>行情截至 ${esc(data.movement.date)}${data.movement.date!==view.date?'（非所選日期，請確認資料新鮮度）':''} · ${data.movement.triggered?'近期異動':'未達預設異動門檻，仍可查看新聞'}</p>${movementPanel(data.movement)}<p>回溯 ${esc(data.coverage.from)}～${esc(data.coverage.to)} · ${rows.length} 則新聞 · ${esc(data.coverage.note)}</p>${data.coverage.failures.length?`<details class="notice" open><summary>部分區間取得失敗</summary>${data.coverage.failures.map(f=>`<p>${esc(f)}</p>`).join('')}</details>`:''}`:''}<div class="stock-actions"><button class="primary" data-event-generate ${!rows.length||view.busy||view.generating?'disabled':''}>${view.generating?'分析中…':'AI 分析可能事件'}</button><button data-event-settings>AI 設定</button></div><small>使用目前 AI 設定。分析保存至此登入帳號的 AI 成果中心，同帳號跨裝置可查看；不同使用者的快取各自獨立。關閉視窗仍會完成已開始的分析，請保持網站分頁開啟。</small><div data-event-answer class="article-summary"></div><h3>新聞時間線與來源</h3><div class="event-timeline">${rows.map((r,i)=>`<article><small>[${i+1}] ${esc(r.news_date)} · ${esc(r.source)} · ${r.news_date<data.movement.from?'異動前':'異動期間／後續說明'}</small><h4><a href="${esc(safeURL(r.article_url||r.url))}" target="_blank" rel="noopener noreferrer">${esc(r.title)}</a></h4><button data-event-source-date="${esc(r.news_date)}">在新聞月曆查看日期</button><small>${r.article_summary?'有既有摘要':'全文尚未讀取；AI 分析時嘗試取得'}</small></article>`).join('')||'<p>尚無可供分析的來源。請先更新資料；沒有新聞不代表沒有事件。</p>'}</div>`;
  showMarkdown(dialog.querySelector('[data-event-answer]'),view.answer);
  dialog.querySelector('[data-event-close]').onclick=view.close;
  dialog.querySelector('[data-event-date]').onchange=e=>{view.date=e.target.value;void load();};
  dialog.querySelector('[data-event-lookback]').onchange=e=>{view.lookback=Number(e.target.value);void load();};
  dialog.querySelector('[data-event-refresh]').onclick=()=>void load(true);
  dialog.querySelector('[data-event-settings]').onclick=()=>openAIWindow();
  dialog.querySelector('[data-event-generate]').onclick=()=>void generate();
  dialog.querySelectorAll('[data-event-source-date]').forEach(b=>b.onclick=()=>{view.close();onDate(b.dataset.eventSourceDate);});
 }
 async function load(refresh=false){const version=++view.version;view.busy=true;view.data=null;view.answer='';view.message='讀取行情與回溯新聞…';draw();
  try{if(refresh)await api('/chart-prices?code='+code,{method:'POST'});
   const data=await api(`/stock-event-news?code=${code}&date=${view.date}&lookback=${view.lookback}`);
   if(!current()||version!==view.version)return;if(data.owner_id!==owner)throw Error('登入身分已變更');view.data=data;view.company=data.company;view.message='新聞已整理，可檢視來源或生成事件分析。';
  }catch(e){if(current()&&version===view.version)view.message='讀取失敗：'+e.message;}
  finally{if(current()&&version===view.version){view.busy=false;draw();}}
 }
 async function generate(){if(view.generating||!view.data)return;view.generating=true;draw();
  const data=view.data,config=currentAISettings(),sessionToken=localStorage.getItem('stock-news-session'),sameAccount=()=>resultOwner()===owner&&localStorage.getItem('stock-news-session')===sessionToken;
  try{const user=await requireAISession();if(user.id!==owner||!sameAccount())throw Error('登入帳號已變更');aiRequest(config,'驗證設定');
   status('檢查此帳號已保存分析…');await syncAccountResults();if(!sameAccount())throw Error('登入帳號已變更');
   const fingerprint=JSON.stringify(['stock-event-v1',data.company.code,view.date,view.lookback,data.movement,config.provider,config.endpoint,config.model,data.coverage.failures,data.news.map(r=>[r.news_date,r.published_at,r.title,r.article_url||r.url,r.article_summary||''])]);
   const key=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(fingerprint))),x=>x.toString(16).padStart(2,'0')).join(''),id='stock-event:'+key,meta={id,title:`${code} ${data.company.name} · ${data.movement.date} 異動追查（${view.lookback}天）`,kind:'text',date:data.movement.date,local_only:companyMode(config)};
   const saved=resultRecords(owner).find(r=>r.id===id&&r.state==='complete'&&r.answer);
   if(saved){view.answer=saved.answer;status('使用此帳號已保存結果，未呼叫 AI。');return;}
   if(!sameAccount())throw Error('登入帳號已變更，停止建立分析工作');
   const output=await runResultJob(meta,async(signal,progress)=>{
    // Company gateways keep all generated content on the existing private path.
    const cloudCache=!companyMode(config),call=body=>api('/stock-event-cache',{body,sessionToken});let lease;
    try{
     if(cloudCache){const claim=await call({key,action:'claim'});if(claim.owner_id!==owner)throw Error('快取帳號不一致');if(claim.answer)return {answer:claim.answer};if(!claim.lease)throw Error('此帳號另一個裝置正在分析相同資料，請稍後再按分析。');lease=claim.lease;}
     const update=m=>{progress(m);status(m);};let articles=[],failed=[];
     const candidates=[...data.news.slice(0,6),...data.news.slice(-6)].filter((r,i,a)=>a.findIndex(x=>x.url===r.url)===i);
     try{({articles,failed}=await readFullNews(candidates,config,{signal,onProgress:update}));}
     catch(e){if(signal.aborted)throw e;failed=candidates.map(r=>({title:r.title,reason:e.message}));update('全文取得不足，將明示限制並使用已收錄標題／摘要');}
     if(!sameAccount())throw Error('登入帳號已變更，停止分析');
     let budget=44000;const evidence=data.news.slice(0,100).map(r=>{const article=articles.find(a=>a.url===r.url);if(!article)return r;const text=article.text.slice(0,Math.min(6000,budget));budget-=text.length;return {...r,text:text+(text.length<article.text.length?'\n（內文節錄，未納入全文其餘部分）':'')};});
     const coverage={...data.coverage,fetchedAt:undefined,readableArticles:articles.length,failedArticles:failed.length,omittedArticles:Math.max(0,data.news.length-100),fullTextSelection:'選取最早與最近各6篇，其他保留標題／既有摘要；長文僅提供節錄'};
     update('AI 正在比對事件、新進展與異動時間…');const generated=await requestAI(config,eventPrompt(data.company,data.movement,evidence,coverage),{signal});
     const refs=[...generated.matchAll(/\[(\d+)\]/g)].map(m=>Number(m[1]));if(refs.some(n=>n<1||n>evidence.length))throw Error('AI 引用了不存在的來源編號，請重試');
     const answer=`**資料限制**：回溯 ${coverage.from}～${coverage.to}；${data.news.length} 則來源，嘗試讀取 ${candidates.length} 篇內文，成功 ${articles.length} 篇。其餘為標題／既有摘要，長文可能節錄。${coverage.failedSegments?'部分日期區間搜尋失敗。':''}搜尋結果不保證完整；未還原股價。\n\n${generated}\n\n**來源索引**\n\n${evidence.map((r,i)=>`- [${i+1}] ${r.news_date} · ${r.source} · [${r.title.replace(/[\[\]]/g,'')}](${safeURL(r.article_url||r.url)})`).join('\n')}`;
     if(!sameAccount())throw Error('登入帳號已變更');
     if(lease)await call({key,action:'save',lease,answer});return {answer,partial:!!failed.length||data.coverage.failedSegments>0,failures:[...data.coverage.failures,...failed.map(f=>`${f.title}：${f.reason}`)]};
    }catch(e){if(lease&&sameAccount())try{await call({key,action:'release',lease});}catch{}throw e;}
   });
   if(current()){view.answer=output.answer;view.message='分析已完成，已保存在此帳號的 AI 成果中心。';}
  }catch(e){status('分析未完成：'+e.message);}
  finally{view.generating=false;if(current())draw();}
 }
 wrap.onkeydown=e=>{if(e.key==='Escape')view.close();if(e.key==='Tab'){const nodes=[...dialog.querySelectorAll('button:not(:disabled),input:not(:disabled),select:not(:disabled),a[href]')],first=nodes[0],last=nodes.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}}};
 draw();dialog.querySelector('[data-event-close]').focus();void load();
}
