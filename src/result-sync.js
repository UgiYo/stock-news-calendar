import {api} from './api.js';
import {syncEnabled,syncOwner,syncResultPayload,deviceData,saveDeviceData} from './account-sync.js';
import {resultRecords,saveResult,removeSyncedResult} from './ai-results.js';
let loading=false,applying=false,last=0;
const sent=new Map(),sentNews=new Set();
export async function syncAccountResults(force=false){
 const who=syncOwner();if(globalThis.document?.visibilityState==='hidden')return;if(!syncEnabled(who)||loading||(!force&&Date.now()-last<300000))return;
 loading=true;last=Date.now();
 try{
  const snapshot=deviceData(who);const news=(snapshot?.news||[]).filter(n=>!sentNews.has(who+':'+n.url)).map(n=>Object.fromEntries(['company_code','title','url','source','published_at','news_date'].map(k=>[k,String(n[k]||'')])));
  for(let i=0;i<news.length;i+=40){if(who!==syncOwner()||!syncEnabled(who))return;const batch=news.slice(i,i+40);await api('/account-news',{body:batch});batch.forEach(n=>sentNews.add(who+':'+n.url));}
  const {news:sharedNews}=await api('/account-news');if(who!==syncOwner()||!syncEnabled(who))return;
  const merged=new Map((deviceData(who)?.news||[]).map(n=>[n.url,n]));for(const n of sharedNews||[])merged.set(n.url,n);saveDeviceData({...deviceData(who),news:[...merged.values()]},who);
  const {results,deleted}=await api('/account-results');if(who!==syncOwner()||!syncEnabled(who))return;
  for(const tombstone of deleted||[]){const row=resultRecords(who).find(r=>r.id===tombstone.id);if(row&&row.updated_at<=tombstone.updated_at)removeSyncedResult(tombstone.id,who);}
  const local=new Map(resultRecords(who).map(r=>[r.id,r]));
  applying=true;
  try{for(const row of results||[]){const own=local.get(row.id);if(!own||row.updated_at>own.updated_at)saveResult(row,{...row,state:'complete'},who);sent.set(who+':'+row.id,row.updated_at);}}finally{applying=false;}
  for(const row of resultRecords(who)){if(who!==syncOwner()||!syncEnabled(who))return;const payload=syncResultPayload(row);if(payload&&sent.get(who+':'+row.id)!==row.updated_at){await api('/account-results',{body:payload});sent.set(who+':'+row.id,row.updated_at);}}
  if(typeof window!=='undefined')window.dispatchEvent(new CustomEvent('account-sync-status',{detail:{who,message:'帳號資料已同步'}}));
 }catch(e){if(typeof window!=='undefined')window.dispatchEvent(new CustomEvent('account-sync-status',{detail:{who,message:'AI 成果同步未完成：'+e.message}}));if(force)throw e;}finally{loading=false;}
}
if(typeof window!=='undefined'){
 window.addEventListener('account-result-saved',e=>{if(!applying&&e.detail.who===syncOwner()&&syncEnabled()&&syncResultPayload(e.detail.row))void syncAccountResults(true);});
 window.addEventListener('account-result-deleted',e=>{if(e.detail.who===syncOwner()&&syncEnabled())void api('/account-results?id='+encodeURIComponent(e.detail.id),{method:'DELETE'}).catch(()=>{});});
 window.addEventListener('focus',()=>void syncAccountResults());setInterval(()=>void syncAccountResults(),300000);
}
