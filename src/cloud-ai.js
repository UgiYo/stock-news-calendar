import {cloudPollDelay} from './d1-quota.js';
import {syncEnabled} from './account-sync.js';
import {resultRecords} from './ai-results.js';
import {assertCloudConfig} from './ai-privacy.js';
import {api} from './api.js';
import {saveResult,openResultsCenter,refreshNotifications} from './ai-results.js';
let syncing=false,currentOwner='guest',lastSync=0;
const received=new Map();
export const cloudOption='<label class="ai-check cloud-ai-option"><input type="checkbox" data-cloud-ai>雲端背景處理（可關閉頁面）</label><small class="cloud-ai-help">需登入。勾選後，本次 Key 加密暫存於後端並交由 GitHub Actions 呼叫指定公開 OpenAI／Azure 端點；完成或失敗後刪除；排隊任务超過 24 小時將逾期。結果保存於帳號下。公司內網端點請使用裝置模式。</small>';
export async function submitCloudTask({kind,title,date,input,config}){
 assertCloudConfig(config,input);
 if(!localStorage.getItem('stock-news-session'))throw Error('請先登入帳號才能使用雲端背景處理。');
 let capability;try{capability=await api('/ai-jobs/capabilities');}catch(e){if(/^D1_/.test(e.code))throw e;throw Error('後端尚未部署雲端背景任務版本，目前請使用裝置模式。');}if(!capability.enabled)throw Error('後端背景任務尚未啟用，請先完成 Worker 設定。');
 const {task}=await api('/ai-jobs',{body:{kind,title,date,input,config,consent:true}});saveCloudTask(task);refreshNotifications();return task;
}
function saveCloudTask(task){saveResult({id:'cloud:'+task.id,title:task.title,kind:task.kind,date:task.date,episode:task.episode,request:task.request},{...task,cloud_id:task.id});}
export function startCloudSync(who){const next=String(who||'guest');if(next!==currentOwner){currentOwner=next;lastSync=0;}if(next==='guest'||syncing||Date.now()-lastSync<cloudPollDelay(resultRecords(next)))return;void syncCloudResults();}
export async function syncCloudResults(){if(currentOwner==='guest'||syncing||globalThis.document?.visibilityState==='hidden')return;const who=currentOwner;syncing=true;lastSync=Date.now();try{const {tasks}=await api('/ai-jobs');if(who===currentOwner)for(const task of tasks||[])if(syncEnabled(who)||resultRecords(who).some(r=>r.cloud_id===task.id)){const key=who+':'+task.id,signature=JSON.stringify(task);if(received.get(key)!==signature){saveCloudTask(task);received.set(key,signature);}}}catch{}finally{syncing=false;}}
if(typeof window!=='undefined'){setInterval(()=>startCloudSync(currentOwner),15000);window.addEventListener('focus',()=>startCloudSync(currentOwner));window.addEventListener('cloud-result-read',e=>{void api('/ai-jobs/read',{body:{id:e.detail}}).catch(()=>{});});}
