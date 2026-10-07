import {createQuotaGate} from './d1-quota.js';
import {deviceRequest,syncEnabled,deviceData} from './account-sync.js';
const base=(import.meta.env?.VITE_WORKER_API_URL||'').replace(/\/$/,'');
const key='stock-news-session';
const quotaGate=createQuotaGate({storage:globalThis.localStorage,key:'stock-d1-pause:'+base});
export async function api(path,options={}){
 const local=await deviceRequest(path,options,remoteAPI);if(local!==undefined)return local;const data=await remoteAPI(path,options);
 if(syncEnabled()&&path.startsWith('/news?')){data.serverCount=data.news?.length||0;const url=new URL(path,'https://device.invalid'),extra=(deviceData()?.news||[]).filter(n=>n.news_date>=url.searchParams.get('from')&&n.news_date<=url.searchParams.get('to'));if(!Number(url.searchParams.get('offset')||0)){const rows=new Map((data.news||[]).map(n=>[n.url,n]));for(const n of extra)rows.set(n.url,n);data.news=[...rows.values()];data.deviceMerged=true;}}
 return data;
}
export async function remoteAPI(path,options={}){
 if(!options.quotaProbe&&!['/podcasts/rss','/podcasts/transcript','/health'].some(p=>path.split('?')[0]===p))quotaGate.check();
 const token=localStorage.getItem(key);if(options.sessionToken!==undefined&&token!==options.sessionToken)throw Error('登入帳號已變更，已停止同步。');const response=await fetch(base+path,{method:options.method||(options.body?'POST':'GET'),headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:options.body?JSON.stringify(options.body):undefined,signal:AbortSignal.timeout(path==='/article-content'?90000:30000)});
 const data=await response.json();if(options.sessionToken!==undefined&&localStorage.getItem(key)!==options.sessionToken)throw Error('登入帳號已變更，已停止同步。');if(!response.ok){quotaGate.note(data);const error=Error(data.error||'後端服務無法使用');error.code=data.code;error.status=response.status;throw error;}if(options.quotaProbe)quotaGate.clear();return data;
}
export function login(){if(!base)throw Error('請先設定 Workers 網址');location.assign(base+'/auth/start');}
export async function logout(){try{await api('/logout',{body:{}});}finally{localStorage.removeItem(key);}}
export async function restore(){const params=new URLSearchParams(location.hash.slice(1));if(params.get('session')){localStorage.setItem(key,params.get('session'));history.replaceState(null,'',location.pathname+location.search);}if(!localStorage.getItem(key))return null;try{return (await api('/me')).user;}catch(e){if(e.status===401)localStorage.removeItem(key);throw e;}}
export async function jobRequest(path,body,onQueued){
 const first=await api(path,{body});if(first.news?.article_summary&&(!body.retry_ai||first.news.summary_method==='ai'))return first;
 if(!first.job)return first;onQueued?.(first);if(first.dispatched===false)throw Error('任務已保存，但 GitHub Actions 未啟動：'+(first.dispatchError||'請確認 Pages Production 的 GITHUB_DISPATCH_TOKEN 與 GITHUB_REPO，並重新部署。')+' 可先手動執行 Update company news（queued）。');
 for(let i=0;i<24;i++){await new Promise(r=>setTimeout(r,5000));const result=await api('/jobs?id='+first.job.id);if(result.job.status==='failed')throw Error(result.job.error||'工作失敗');if(result.job.status==='done')return result;}
 throw Error('工作仍在排隊或處理中，稍後重新整理即可查看結果。');
}
