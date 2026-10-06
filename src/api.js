const base=(import.meta.env?.VITE_WORKER_API_URL||'').replace(/\/$/,'');
const key='stock-news-session';
export async function api(path,options={}){
 const token=localStorage.getItem(key);const response=await fetch(base+path,{method:options.method||(options.body?'POST':'GET'),headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:options.body?JSON.stringify(options.body):undefined,signal:AbortSignal.timeout(path==='/article-content'?90000:30000)});
 const data=await response.json();if(!response.ok)throw Error(data.error||'後端服務無法使用');return data;
}
export function login(){if(!base)throw Error('請先設定 Workers 網址');location.assign(base+'/auth/start');}
export async function logout(){try{await api('/logout',{body:{}});}finally{localStorage.removeItem(key);}}
const companyKey='stock-news-company-login';
function randomLoginValue(){return btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');}
export async function companyLogin(){
 if(!base)throw Error('請先設定 Workers 網址');
 const state=randomLoginValue(),verifier=randomLoginValue();
 const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(verifier));
 const challenge=btoa(String.fromCharCode(...new Uint8Array(digest))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
 const result=await api('/auth/company/start',{body:{state,challenge}});
 sessionStorage.setItem(companyKey,JSON.stringify({state,verifier,created:Date.now()}));location.assign(result.url);
}
export async function restore(){const params=new URLSearchParams(location.hash.slice(1));if(params.has('company_code')){
 const code=params.get('company_code'),state=params.get('state');history.replaceState(null,'',location.pathname+location.search);
 const pending=JSON.parse(sessionStorage.getItem(companyKey)||'null');sessionStorage.removeItem(companyKey);
 if(!pending||pending.state!==state||Date.now()-pending.created>300000)throw Error('公司登入交易無效，請重新登入');
 const result=await api('/auth/company/exchange',{body:{code,state,verifier:pending.verifier}});localStorage.setItem(key,result.session);
 }if(params.get('session')){localStorage.setItem(key,params.get('session'));history.replaceState(null,'',location.pathname+location.search);}if(!localStorage.getItem(key))return null;try{return (await api('/me')).user;}catch(e){localStorage.removeItem(key);throw e;}}
export async function jobRequest(path,body,onQueued){
 const first=await api(path,{body});if(first.news?.article_summary&&(!body.retry_ai||first.news.summary_method==='ai'))return first;
 if(!first.job)return first;onQueued?.(first);if(first.dispatched===false)throw Error('任務已保存，但 GitHub Actions 未啟動：'+(first.dispatchError||'請確認 Pages Production 的 GITHUB_DISPATCH_TOKEN 與 GITHUB_REPO，並重新部署。')+' 可先手動執行 Update company news（queued）。');
 for(let i=0;i<24;i++){await new Promise(r=>setTimeout(r,5000));const result=await api('/jobs?id='+first.job.id);if(result.job.status==='failed')throw Error(result.job.error||'工作失敗');if(result.job.status==='done')return result;}
 throw Error('工作仍在排隊或處理中，稍後重新整理即可查看結果。');
}

