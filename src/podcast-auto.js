import {currentAISettings,aiRequest} from './local-ai.js';
import {readSTTSettings} from './podcast-stt.js';
import {downloadAudio} from './podcasts.js';
import {generatePodcastHighlights} from './podcast-ai.js';
import {activeResultJob,resultRecords,runResultJob,saveResult} from './ai-results.js';
import {requireAISession} from './ai-auth.js';
const KEY='stock-podcast-auto-device-v1';
let enabled=false;try{enabled=localStorage.getItem(KEY)==='true';}catch{}
let skipped=new Set();try{skipped=new Set(JSON.parse(localStorage.getItem(KEY+'-skipped')||'[]'));}catch{}
let blocked=new Set();try{blocked=new Set(JSON.parse(localStorage.getItem(KEY+'-blocked')||'[]'));}catch{}
function persistBlocked(){try{localStorage.setItem(KEY+'-blocked',JSON.stringify([...blocked]));}catch{}}
let currentId='',currentProgress='',running=false,message='',attempted=new Set();
export function podcastAutoState(){return {enabled,running,message,currentId,currentProgress,skipped:[...skipped],blocked:[...blocked]};}
export function skipPodcastEpisode(id,skip=true){if(skip){skipped.add(id);blocked.delete(id);if(currentId===id)activeResultJob(id)?.controller.abort();}else{skipped.delete(id);blocked.delete(id);attempted.delete(id);}persistBlocked();try{localStorage.setItem(KEY+'-skipped',JSON.stringify([...skipped]));}catch{}changed();}
function changed(){window.dispatchEvent(new CustomEvent('podcast-auto-status'));}
if(typeof window!=='undefined')window.addEventListener('account-result-saved',event=>{const row=event.detail?.row;if(blocked.has(row?.id)&&row.state==='complete'&&row.answer){blocked.delete(row.id);persistBlocked();changed();}});
export function setPodcastAuto(value){enabled=!!value;try{localStorage.setItem(KEY,String(enabled));}catch{}if(enabled)attempted.clear();message=enabled?'自動處理已開啟，準備補齊歷史集數。':'自動處理已關閉；執行中的集數可在成果中心取消。';changed();}
export function pendingPodcastEpisodes(episodes,records,attempts=new Set(),blockedEpisodes=blocked){return [...episodes].sort((a,b)=>String(b.date).localeCompare(String(a.date))).filter(e=>{const id='podcast:'+e.id,row=records.find(r=>r.id===id);return !attempts.has(id)&&!blockedEpisodes.has(id)&&!(row?.text&&row?.answer&&!row.partial&&row.state==='complete');});}
export async function runPodcastAuto(episodes,who,{retry=false,isCurrent=()=>true}={}){
 if(!enabled||running||!who||who==='guest')return;
 if(retry)attempted.clear();running=true;
 try{
 await requireAISession();const config={...currentAISettings(),stt:readSTTSettings()};aiRequest(config,'驗證設定');
 if(config.transport==='python')throw Error('自動處理目前使用瀏覽器直連；請在 AI 設定選擇直接連線。');
 if(!config.stt.enabled&&config.provider==='azure')throw Error('請先配置獨立 Whisper，供自動轉錄使用。');
 for(const e of pendingPodcastEpisodes(episodes,resultRecords(who,true),attempted,blocked)){
 if(!enabled||!isCurrent())break;
 const id='podcast:'+e.id;if(skipped.has(id)||activeResultJob(id))continue;currentId=id;currentProgress='準備下載／生成';
 const previous=resultRecords(who,true).find(r=>r.id===id)||{};
 attempted.add(id);message='自動處理：'+e.title;changed();
 const meta={id,title:e.title,kind:'podcast',date:e.date,episode:e,local_only:config.provider==='litellm'||config.stt.enabled};
 try{await runResultJob(meta,async(signal,progress)=>{
 const timer=setTimeout(()=>activeResultJob(id)?.controller.abort(),45*60000);
 try{const result=await generatePodcastHighlights(config,e,{text:previous.text||'',model:config.stt.enabled?config.stt.model:'whisper-1',transcriptionModel:previous.transcription_model||'',partial:previous.partial||previous.state==='interrupted',segments:previous.segments||[],failures:previous.failures||[],signal,fetchAudio:downloadAudio,onProgress:text=>{progress(text);currentProgress=text;message='自動處理：'+e.title+' · '+text;changed();},onTranscript:r=>saveResult(meta,{...resultRecords(who,true).find(x=>x.id===id),text:r.text,segments:r.segments,failures:r.failed,partial:r.partial,transcription_model:r.transcription_model,state:'running'},who)});return {...resultRecords(who,true).find(x=>x.id===id),...result,failures:result.failed};}finally{clearTimeout(timer);}
 });}catch(error){if(skipped.has(id)){currentId='';currentProgress='';continue;}if(/音訊上限\s*120\s*MB/i.test(error.message||'')){blocked.add(id);persistBlocked();message=`${e.channel_name||'Podcast'} · ${e.date||'日期未標示'} · ${e.title}：音訊超過 120 MB，已略過此集並繼續處理其他集數。`;changed();continue;}
 message='自動處理已暫停：'+error.message+'。確認連線後按「補齊／重試歷史集數」。';changed();return;}
 }
 const blockedItems=episodes.filter(e=>blocked.has('podcast:'+e.id));const blockedNames=blockedItems.slice(0,3).map(e=>`${e.channel_name||'Podcast'} · ${e.date||'日期未標示'} · ${e.title}`).join('；');
 message=blockedItems.length?`需手動處理 ${blockedItems.length} 集（音訊超過 120 MB）：${blockedNames}${blockedItems.length>3?'；另有 '+(blockedItems.length-3)+' 集':''}。請在處理進度開啟對應集數，匯入較小分段音訊或逐字稿。`:enabled?'本裝置已處理完目前載入的集數；完成通知在 AI 成果中心。':'自動處理已停止。';
 }catch(error){message='等待設定／連線：'+error.message;}finally{running=false;currentId='';currentProgress='';changed();}
}
