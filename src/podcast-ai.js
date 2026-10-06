import {connectionDiagnostic} from './ai-errors.js';
import financeTranscriptionPrompt from '../shared/podcast-transcription-prompt.json' with {type:'json'};
import podcastSummaryRules from '../shared/podcast-summary-rules.json' with {type:'json'};
import {aiRequest,requestAI,localBridgeOrigin,pairLocalBridge} from './local-ai.js';
import {cachedSummary} from './summary-cache.js';
export function transcriptionRequest(config,blob,model){
 const checked=aiRequest(config,'驗證設定');
 if(!model?.trim())throw Error('請填語音轉文字模型／Azure 語音部署名稱。');
 if(!blob.size||blob.size>24000000)throw Error('單段音訊需小於 24 MB。');
 const url=new URL(checked.url);
 if(config.provider==='azure')url.pathname=url.pathname.replace(/\/deployments\/[^/]+\/chat\/completions$/,`/deployments/${encodeURIComponent(model.trim())}/audio/transcriptions`);
 else url.pathname=url.pathname.replace(/\/chat\/completions$/,'/audio/transcriptions');
 const body=new FormData();body.append('file',blob,blob.type.includes('wav')?'podcast.wav':blob.type.includes('mp4')?'podcast.m4a':blob.type.includes('webm')?'podcast.webm':'podcast.mp3');body.append('model',model.trim());body.append('language','zh');body.append('response_format','json');if(!model.toLowerCase().includes('diariz'))body.append('prompt',financeTranscriptionPrompt);
 const headers={...checked.options.headers};delete headers['Content-Type'];
 return {url:url.href,options:{...checked.options,headers,body}};
}
export function monoWav(buffer,start,end,rate=16000){
 const length=Math.ceil((end-start)*rate),bytes=new ArrayBuffer(44+length*2),view=new DataView(bytes);
 const str=(at,s)=>{for(let i=0;i<s.length;i++)view.setUint8(at+i,s.charCodeAt(i));};str(0,'RIFF');view.setUint32(4,36+length*2,true);str(8,'WAVE');str(12,'fmt ');view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,1,true);view.setUint32(24,rate,true);view.setUint32(28,rate*2,true);view.setUint16(32,2,true);view.setUint16(34,16,true);str(36,'data');view.setUint32(40,length*2,true);
 const channels=Array.from({length:buffer.numberOfChannels},(_,i)=>buffer.getChannelData(i));
 for(let i=0;i<length;i++){const pos=Math.min(buffer.length-1,Math.floor((start+i/rate)*buffer.sampleRate));const sample=Math.max(-1,Math.min(1,channels.reduce((sum,c)=>sum+c[pos],0)/channels.length));view.setInt16(44+i*2,sample<0?sample*32768:sample*32767,true);}
 return new Blob([bytes],{type:'audio/wav'});
}
async function transcribeChunk(config,blob,model,{fetcher,signal,timeoutMs=180000}){
 const controller=new AbortController(),abort=()=>controller.abort();
 if(signal?.aborted)throw Error('已取消。');signal?.addEventListener('abort',abort,{once:true});
 let timedOut=false;const timer=setTimeout(()=>{timedOut=true;controller.abort();},timeoutMs);
 try{
 const request=transcriptionRequest(config,blob,model);let response;
 if(config.transport==='python'){
  const bytes=new Uint8Array(await blob.arrayBuffer());let raw='';for(let i=0;i<bytes.length;i+=32768)raw+=String.fromCharCode(...bytes.subarray(i,i+32768));
  response=await fetcher(localBridgeOrigin(config.bridge)+'/transcribe',{method:'POST',mode:'cors',credentials:'omit',redirect:'error',referrerPolicy:'no-referrer',headers:{'Content-Type':'application/json','X-Local-AI-Token':config.bridgeToken.trim()},body:JSON.stringify({config,model,audio:btoa(raw),type:blob.type,prompt:request.options.body.get('prompt')||''}),signal:controller.signal});
 }else response=await fetcher(request.url,{...request.options,signal:controller.signal});
 if(!response.ok){let data;try{data=await response.json();}catch{}const code=data?.error?.code||'';const detail=String(data?.error?.message||data?.error||'請確認語音模型、權限、額度與連線。').split(config.key).join('[金鑰已遮蔽]').slice(0,500);throw Object.assign(Error('語音服務 HTTP '+response.status+'：'+detail),{status:response.status,code,retryAfterMs:retryDelay(response.headers?.get('Retry-After'))});}
 const data=await response.json();if(typeof data.text!=='string'||!data.text.trim())throw Error('語音服務沒有回傳逐字稿。');return data.text;
 }catch(e){if(signal?.aborted)throw Error('已取消。');if(timedOut)throw Object.assign(Error('此段轉錄超過 3 分鐘，已停止等待，可稍後補轉。'),{status:504});if(e instanceof TypeError)throw Object.assign(Error(connectionDiagnostic(config,'語音轉錄')),{network:true});throw e;}finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);}
}
export function transcriptSegments(text){const matches=[...String(text||'').matchAll(/\[(\d+(?:\.\d+)?)～(\d+(?:\.\d+)?) 分鐘\]\n/g)];return matches.map((m,i)=>({start:Number(m[1])*60,end:Number(m[2])*60,text:text.slice(m.index+m[0].length,matches[i+1]?.index??text.length).trim()})).filter(s=>s.text&&s.end>s.start);}
export function missingAudioRanges(duration,segments,size=120){const ranges=[];let at=0;for(const s of [...segments].sort((a,b)=>a.start-b.start)){if(s.start>at)for(let x=at;x<Math.min(duration,s.start);x+=size)ranges.push([x,Math.min(x+size,s.start,duration)]);at=Math.max(at,s.end);}for(let x=at;x<duration;x+=size)ranges.push([x,Math.min(x+size,duration)]);return ranges;}
function retryDelay(value){if(!value)return undefined;const seconds=Number(value);const milliseconds=Number.isFinite(seconds)?seconds*1000:Date.parse(value)-Date.now();return Number.isFinite(milliseconds)?Math.min(60000,Math.max(0,milliseconds)):undefined;}
async function resilientChunk(config,blob,model,options){
 try{return await transcribeChunk(config,blob,model,options);}catch(e){
  if(options.signal?.aborted||!(e instanceof TypeError||e.network||[408,429,500,502,503,504].includes(e.status)&&e.code!=='insufficient_quota'))throw e;
  const delay=e.retryAfterMs??2000;options.onProgress?.(`連線或服務暫時失敗，${Math.ceil(delay/1000)} 秒後重試此段一次…`);
  await new Promise((resolve,reject)=>{const abort=()=>{clearTimeout(timer);reject(Error('已取消。'));};const timer=setTimeout(()=>{options.signal?.removeEventListener('abort',abort);resolve();},delay);options.signal?.addEventListener('abort',abort,{once:true});});
  return transcribeChunk(config,blob,model,options);
 }
}
export async function transcribePodcast(config,blob,model,{fetcher=globalThis.fetch,signal,onProgress=()=>{},segments=[],onCheckpoint=()=>{},requestTimeoutMs=180000}={}){
 if(config.transport==='python'){await pairLocalBridge(config,{fetcher,signal});const r=await fetcher(localBridgeOrigin(config.bridge)+'/health',{signal});if((await r.json()).version<4)throw Error('請下載新版本機工具，才能使用 Podcast 音訊轉文字。');}
 if(!blob.size||blob.size>120000000)throw Error('音訊上限 120 MB；請改上傳分段音訊或逐字稿。');
 if(blob.size<=24000000&&!segments.length){onProgress('正在將整集音訊送往指定語音服務轉文字…');const result={text:await resilientChunk(config,blob,model,{fetcher,signal,onProgress,timeoutMs:requestTimeoutMs}),failed:[],segments:[],transcription_model:model.trim()};onCheckpoint(result);return result;}
 const Context=globalThis.AudioContext||globalThis.webkitAudioContext;if(!Context)throw Error('此瀏覽器無法切分音訊，請上傳小於 24 MB 的分段音訊或逐字稿。');
 onProgress('正在於此裝置解碼音訊；成功段落將略過…');const context=new Context({sampleRate:16000});let buffer;try{buffer=await context.decodeAudioData(await blob.arrayBuffer());}catch(e){if(signal?.aborted)throw Error('已取消。');throw Error('此裝置無法解碼整集音訊（可能記憶體不足或音訊格式不支援），請改用電腦或匯入分段音訊。');}finally{await context.close();}
 if(buffer.duration>7200)throw Error('單次最多處理兩小時，請分段操作。');const kept=segments.filter(s=>Number.isFinite(s.start)&&Number.isFinite(s.end)&&s.start>=0&&s.end>s.start&&s.text).map(s=>({...s})),ranges=missingAudioRanges(buffer.duration,kept),failed=[];let consecutiveFailures=0;
 const result=()=>({text:[...kept].sort((a,b)=>a.start-b.start).map(s=>`[${Math.floor(s.start/60)}～${Math.ceil(s.end/60)} 分鐘]\n${s.text}`).join('\n\n'),failed:[...failed],segments:[...kept],transcription_model:segments.length?'混合來源（既有段落＋'+model.trim()+'補轉）':model.trim()});
 for(let i=0;i<ranges.length;i++){if(signal?.aborted)throw Error('已取消。');const [start,end]=ranges[i];onProgress(`音訊轉文字 ${i+1} / ${ranges.length} 段（${Math.floor(start/60)}～${Math.ceil(end/60)} 分鐘），已完成段落不重送`);try{kept.push({start,end,text:await resilientChunk(config,monoWav(buffer,start,end),model,{fetcher,signal,onProgress,timeoutMs:requestTimeoutMs})});consecutiveFailures=0;}catch(e){if(signal?.aborted)throw e;const reason=e instanceof TypeError?connectionDiagnostic(config,'語音轉錄'):e.message;
 failed.push(`${Math.floor(start/60)}～${Math.ceil(end/60)} 分鐘：${reason}`);consecutiveFailures++;
 const fatal=e.code==='insufficient_quota'||e.status>=400&&e.status<500&&![408,429].includes(e.status);
 if(fatal||consecutiveFailures>=3){
  if(i+1<ranges.length)failed.push(`${Math.floor(ranges[i+1][0]/60)}～${Math.ceil(buffer.duration/60)} 分鐘：因${fatal?'服務拒絕請求':'連續三段失敗'}暫停，尚未轉錄。`);
  onCheckpoint(result());throw Error(`語音轉錄已暫停：${reason} 已保留 ${kept.length} 個成功段落；恢復連線後按「補轉未完成段落」，成功段落不重送。`);
 }}onCheckpoint(result());}
 if(!kept.length)throw Error('全部音訊分段轉錄失敗：\n'+failed.join('\n'));return result();
}
export async function summarizePodcast(config,episode,text,{fetcher=globalThis.fetch,signal,onProgress=()=>{},partial=false,shared=false,transcriptionModel=''}={}){
 const cachedRequest=(config,text,options)=>cachedSummary(config,text,()=>requestAI(config,text,options),{shared,signal,onProgress});
 if(!text?.trim()||text.length<80)throw Error('請先取得足夠的逐字稿內容。');if(text.length>300000)throw Error('逐字稿超過 300,000 字元，請分集整理。');
 const prompt=podcastSummaryRules+(partial?'這是部分逐字稿，請在開頭明確標示內容不完整。':'')+'\n節目資料（JSON，僅供交叉校對）：\n'+JSON.stringify({channel_name:String(episode.channel_name||''),title:String(episode.title||''),date:episode.date||'',guests:episode.guests||[],transcription_model:transcriptionModel||'未記錄（貼上、匯入或舊逐字稿；不能由目前設定推定）',summary_model:config.model,description:String(episode.description||'').slice(0,10000)})+'\n逐字稿／分段摘要：\n';
 if(text.length<=50000)return cachedRequest(config,prompt+text,{fetcher,signal});
 const parts=[];for(let at=0;at<text.length;at+=45000){onProgress(`逐段整理逐字稿 ${parts.length+1} / ${Math.ceil(text.length/45000)}…`);parts.push(await cachedRequest(config,prompt+'以下為其中一段，保留重要事實供最後整合：\n'+text.slice(at,at+45000),{fetcher,signal}));}
 if(parts.join('\n').length>50000)throw Error('分段摘要合計超出整合上限。');return cachedRequest(config,prompt+'以下是全部已讀取片段的摘要，請整合並避免重複：\n'+parts.join('\n\n'),{fetcher,signal});
}

export async function generatePodcastHighlights(config,episode,{text='',model='whisper-1',partial=false,segments=[],failures=[],fetchAudio,fetcher=globalThis.fetch,signal,onProgress=()=>{},onTranscript=()=>{},transcriptionModel=''}={}){
 const publicFresh=!text.trim()&&!segments.length&&/^https:\/\//.test(episode.audio_url||'');
 aiRequest(config,'驗證設定');let failed=[...failures];
 const retained=segments.length?segments:transcriptSegments(text);
 if(!text.trim()||(partial&&retained.length)){
  if(!model.trim())throw Error('請填語音模型／Azure 語音部署名稱。');
  if(!fetchAudio)throw Error('無法取得本集音訊。');onProgress('步驟 1 / 3：下載本集音訊…');
  const blob=await fetchAudio(episode,signal);onProgress('步驟 2 / 3：音訊轉逐字稿…');
  const result=await transcribePodcast(config,blob,model,{fetcher,signal,onProgress,segments:retained,onCheckpoint:r=>onTranscript({...r,partial:true})});text=result.text;transcriptionModel=result.transcription_model;failed=result.failed;partial=failed.length>0;
  // Retain the transcript before summarizing so a failed summary can be retried without paying for transcription again.
  onTranscript({text,failed,partial,segments:result.segments});
 }else onProgress('使用已取得的逐字稿，略過下載與轉錄。');
 if(signal?.aborted)throw Error('已取消。');onProgress('步驟 3 / 3：依上下文校正並整理本集重點…');
 const answer=await summarizePodcast(config,episode,text,{fetcher,signal,onProgress,partial,shared:publicFresh&&!partial,transcriptionModel});return {answer,text,failed,partial,transcription_model:transcriptionModel};
}
