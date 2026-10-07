import {api} from './api.js';
import {syncEnabled,syncOwner,syncResultPayload,deviceData,saveDeviceData} from './account-sync.js';
import {resultRecords,saveResult,removeSyncedResult} from './ai-results.js';
let loading=false,applying=false,again=false;
const last=new Map(),sent=new Map(),sentNews=new Set();
export async function syncAccountResults(force=false){
 const who=syncOwner(),sessionToken=globalThis.localStorage?.getItem('stock-news-session');if(who==='guest'||!sessionToken||globalThis.document?.visibilityState==='hidden')return;
 if(loading){if(force)again=true;return;}if(!force&&Date.now()-(last.get(who)||0)<300000)return;
 loading=true;last.set(who,Date.now());const options={sessionToken},current=()=>who===syncOwner()&&globalThis.localStorage?.getItem('stock-news-session')===sessionToken;
 const status=message=>{if(current()&&typeof window!=='undefined')window.dispatchEvent(new CustomEvent('account-sync-status',{detail:{who,message}}));};
 try{
  status('正在同步此帳號的 AI 成果…');
  const remote=[];let offset=0;
  while(true){if(!current())return;const page=await api('/account-results?offset='+offset,options);if(!current())return;if(page.owner_id!==who)throw Error('登入身分核對不一致，已停止成果同步。');remote.push(page);if(!page.has_more)break;offset+=page.count;}
  const local=new Map(resultRecords(who).map(r=>[r.id,r]));applying=true;
  try{for(const page of remote){for(const tombstone of page.deleted||[]){const row=local.get(tombstone.id);if(row&&row.updated_at<=tombstone.updated_at){removeSyncedResult(tombstone.id,who);local.delete(tombstone.id);}}for(const row of page.results||[]){const own=local.get(row.id);if(!own||row.updated_at>own.updated_at){saveResult(row,{...row,state:'complete'},who);local.set(row.id,row);}sent.set(who+':'+row.id,row.updated_at);}}}finally{applying=false;}
  for(const row of resultRecords(who)){if(!current())return;const payload=syncResultPayload(row,who);if(payload&&sent.get(who+':'+row.id)!==row.updated_at){await api('/account-results',{...options,body:payload});if(!current())return;sent.set(who+':'+row.id,row.updated_at);}}
  status('AI 成果已同步，僅此登入帳號可跨裝置查看');
  if(syncEnabled(who)){
   const snapshot=deviceData(who),news=(snapshot?.news||[]).filter(n=>!sentNews.has(who+':'+n.url)).map(n=>Object.fromEntries(['company_code','title','url','source','published_at','news_date'].map(k=>[k,String(n[k]||'')])));
   for(let i=0;i<news.length;i+=40){if(!current()||!syncEnabled(who))return;const batch=news.slice(i,i+40);await api('/account-news',{...options,body:batch});batch.forEach(n=>sentNews.add(who+':'+n.url));}
   const {news:sharedNews}=await api('/account-news',options);if(!current()||!syncEnabled(who))return;
   const merged=new Map((deviceData(who)?.news||[]).map(n=>[n.url,n]));for(const n of sharedNews||[])merged.set(n.url,n);saveDeviceData({...deviceData(who),news:[...merged.values()]},who);
  }
 }catch(e){status('AI 成果同步未完成：'+e.message);if(force)throw e;}finally{loading=false;if(again){again=false;void syncAccountResults(true).catch(()=>{});}}
}
if(typeof window!=='undefined'){
 window.addEventListener('account-result-saved',e=>{if(!applying&&e.detail.who===syncOwner()&&syncResultPayload(e.detail.row,e.detail.who))void syncAccountResults(true).catch(()=>{});});
 window.addEventListener('account-result-deleted',e=>{const who=syncOwner(),sessionToken=localStorage.getItem('stock-news-session');if(e.detail.who===who&&who!=='guest'&&sessionToken)void api('/account-results?id='+encodeURIComponent(e.detail.id),{method:'DELETE',sessionToken}).catch(()=>{});});
 window.addEventListener('focus',()=>void syncAccountResults());setInterval(()=>void syncAccountResults(),300000);
}
