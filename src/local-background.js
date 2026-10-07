import {saveResult,notifyLocalCompletion,removeLocalResult,resultOwner,resultRecords} from './ai-results.js';
let connection=null,busy=false,timer=null;
const seen=new Map(),taskOwners=new Map();
const ownershipKey=(origin,id)=>'stock-local-task-owner:'+encodeURIComponent(origin)+':'+encodeURIComponent(id);
function taskOwner(origin,id){const key=ownershipKey(origin,id);try{return localStorage.getItem(key)||taskOwners.get(key);}catch{return taskOwners.get(key);}}
function bindTask(origin,id,who){const key=ownershipKey(origin,id);taskOwners.set(key,who);try{localStorage.setItem(key,who);}catch{}}

export function localOrigin(config){const u=new URL(config.bridge);if(u.protocol!=='http:'||u.hostname!=='127.0.0.1'||u.username||u.password||u.search||u.hash||u.pathname!=='/')throw Error('本機工具只接受 http://127.0.0.1:連接埠。');return u.origin;}
export async function localCall(config,body,{fetcher=globalThis.fetch}={}){
 if(!config.bridgeToken?.trim())throw Error('請先輸入本機配對碼。');
 const response=await fetcher(localOrigin(config)+'/local-jobs',{method:'POST',credentials:'omit',redirect:'error',referrerPolicy:'no-referrer',headers:{'Content-Type':'application/json','X-Local-AI-Token':config.bridgeToken.trim()},body:JSON.stringify(body),signal:AbortSignal.timeout(15000)});
 const data=await response.json();if(!response.ok)throw Error(response.status===404?'請更新至第 5 版本機工具，舊版不支援背景任務。':data.error||'本機任務服務無法使用');return data;
}
function save(task,who=resultOwner()){
 if(who!==resultOwner())return null;
 const key=who+':'+task.id,previous=seen.get(key);seen.set(key,task.state);
 const row=saveResult({id:'local:'+task.id,kind:task.kind==='text'?'news':task.kind,title:task.title,date:task.date,episode:task.episode},{...task,local_id:task.id,local_only:true},who);
 if(previous&&previous!==task.state&&['complete','interrupted'].includes(task.state))notifyLocalCompletion(row);
 return row;
}
export async function syncLocalResults(){if(!connection||busy)return;busy=true;const snapshot=connection;try{const {tasks}=await localCall(snapshot,{action:'list'});if(connection===snapshot&&snapshot.owner===resultOwner())for(const task of tasks){const who=taskOwner(localOrigin(snapshot),task.id);if(who===snapshot.owner)save(task,who);}}catch{/* No cloud fallback. Pair again after restarting the local tool. */}finally{busy=false;}}
export function startLocalSync(config){
 if(config?.provider!=='litellm'||config.transport!=='python'||!config.bridgeToken){connection=null;return;}
 connection={bridge:config.bridge,bridgeToken:config.bridgeToken,owner:resultOwner()};void syncLocalResults();
 if(!timer&&typeof window!=='undefined')timer=setInterval(syncLocalResults,5000);
}
export async function submitLocalTask({config,...task},{fetcher=globalThis.fetch}={}){
 const who=resultOwner();
 if(config.provider!=='litellm'||config.transport!=='python')throw Error('本機背景模式需選擇 LiteLLM 與本機 Python。');
 const response=await fetcher(localOrigin(config)+'/health',{credentials:'omit',redirect:'error',referrerPolicy:'no-referrer',signal:AbortSignal.timeout(5000)});
 const health=await response.json();if(!response.ok||health.service!=='stock-news-local-ai'||health.version<5||!health.local_jobs)throw Error('請更新至第 5 版本機工具，再使用本機背景任務。');
 const {provider,endpoint,model,key,version}=config;
 const {task:result}=await localCall(config,{action:'submit',...task,config:{provider,endpoint,model,key,version}},{fetcher});
 bindTask(localOrigin(config),result.id,who);if(who===resultOwner()){save(result,who);if(fetcher===globalThis.fetch)startLocalSync(config);}return result;
}
export async function localResultAction(id,action,config){
 const c=config||connection;if(!c)throw Error('請到 AI 設定重新配對本機工具，再操作本機成果。');
 const who=resultOwner();if(taskOwner(localOrigin(c),id)!==who)throw Error('此本機任務未綁定目前登入帳號。');
 const data=await localCall(c,{action,id,...(action==='resume'?{config}:{})});
 if(action==='delete'){removeLocalResult(id,who);seen.delete(who+':'+id);}else if(who===resultOwner())save(data.task,who);
 return data.task;
}
if(typeof window!=='undefined')window.addEventListener('focus',()=>void syncLocalResults());
