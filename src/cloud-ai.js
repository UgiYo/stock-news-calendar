import {cloudPollDelay} from './d1-quota.js';
import {syncOwner} from './account-sync.js';
import {resultRecords} from './ai-results.js';
import {assertCloudConfig} from './ai-privacy.js';
import {api} from './api.js';
import {saveResult,openResultsCenter,refreshNotifications} from './ai-results.js';
let syncing=false,currentOwner='guest',lastSync=0;
const received=new Map(),initializedOwners=new Set();
export const cloudOption='<label class="ai-check cloud-ai-option"><input type="checkbox" data-cloud-ai>雲端背景處理（可關閉頁面）</label><small class="cloud-ai-help">需登入。勾選後，本次 Key 加密暫存於後端並交由 GitHub Actions 呼叫指定公開 OpenAI／Azure 端點；完成或失敗後刪除；排隊任务超過 24 小時將逾期。結果保存於帳號下。公司內網端點請使用裝置模式。</small>';
export async function submitCloudTask({kind,title,date,input,config}){
 assertCloudConfig(config,input);
 const who=syncOwner(),sessionToken=localStorage.getItem('stock-news-session');if(who==='guest'||!sessionToken)throw Error('請先登入帳號才能使用雲端背景處理。');
 let capability;try{capability=await api('/ai-jobs/capabilities',{sessionToken});}catch(e){if(/^D1_/.test(e.code))throw e;throw Error('後端尚未部署雲端背景任務版本，目前請使用裝置模式。');}if(!capability.enabled)throw Error('後端背景任務尚未啟用，請先完成 Worker 設定。');
 const {task}=await api('/ai-jobs',{sessionToken,body:{kind,title,date,input,config,consent:true}});saveCloudTask(task,who);refreshNotifications();return task;
}
function saveCloudTask(task,who=currentOwner){saveResult({id:'cloud:'+task.id,title:task.title,kind:task.kind,date:task.date,episode:task.episode,request:task.request},{...task,cloud_id:task.id},who);}
export function startCloudSync(who){const next=String(who||'guest');if(next!==currentOwner){currentOwner=next;lastSync=0;}if(next==='guest'||syncing||Date.now()-lastSync<cloudPollDelay(resultRecords(next)))return;void syncCloudResults();}
export async function syncCloudResults(){if(currentOwner==='guest'||syncing||globalThis.document?.visibilityState==='hidden')return;const who=currentOwner,sessionToken=localStorage.getItem('stock-news-session');if(!sessionToken)return;syncing=true;lastSync=Date.now();try{let offset=0;const initial=!initializedOwners.has(who);while(true){const page=await api('/ai-jobs?offset='+offset,{sessionToken});if(who!==currentOwner)return;if(page.owner_id!==who)throw Error('登入身分核對不一致');for(const task of page.tasks||[]){const key=who+':'+task.id,signature=JSON.stringify(task);if(received.get(key)!==signature){saveCloudTask(task,who);received.set(key,signature);}}if(!initial||!page.has_more)break;offset+=page.count;}initializedOwners.add(who);}catch{}finally{syncing=false;}}

if(typeof window!=='undefined'){setInterval(()=>startCloudSync(currentOwner),15000);window.addEventListener('focus',()=>startCloudSync(currentOwner));window.addEventListener('cloud-result-read',e=>{void api('/ai-jobs/read',{body:{id:e.detail}}).catch(()=>{});});}
