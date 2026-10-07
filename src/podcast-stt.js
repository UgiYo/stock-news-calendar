const STORAGE='stock-news-podcast-stt-v1';
const defaults={enabled:false,endpoint:'',model:'smg-whisper',key:''};
export function loadSTTSettings(storage=globalThis.localStorage){try{return {...defaults,...JSON.parse(storage?.getItem(STORAGE)||'null')};}catch{return {...defaults};}}
let settings=loadSTTSettings();
export function readSTTSettings(){return {...settings};}
export function rememberSTTSettings(storage=globalThis.localStorage){try{return !!storage?.getItem(STORAGE);}catch{return false;}}
export function saveSTTSettings(value,remember=false,storage=globalThis.localStorage){
 const next={enabled:!!value.enabled,endpoint:String(value.endpoint||'').trim(),model:String(value.model||'smg-whisper').trim(),key:String(value.key||'').trim()};
 if(remember)storage?.setItem(STORAGE,JSON.stringify(next));else storage?.removeItem(STORAGE);
 settings=next;
}
export function independentSTTRequest(stt,blob){
 const url=new URL(stt.endpoint);
 if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash||!url.pathname.endsWith('/audio/transcriptions'))throw Error('語音網址需為 HTTPS，並以 /audio/transcriptions 結尾。');
 if(url.hostname.endsWith('.pages.dev')||url.hostname.endsWith('.workers.dev')||url.hostname.endsWith('.github.io')||url.hostname===globalThis.location?.hostname)throw Error('請填語音服務網址，不能將語音金鑰送往網站後端。');
 if(!stt.key?.trim()||!stt.model?.trim())throw Error('請填獨立語音模型與 API Key。');
 if(!blob.size||blob.size>24000000)throw Error('單段音訊需小於 24 MB。');
 const body=new FormData();body.append('model',stt.model.trim());body.append('file',blob,blob.type.includes('wav')?'podcast.wav':blob.type.includes('mp4')?'podcast.m4a':blob.type.includes('webm')?'podcast.webm':'podcast.mp3');
 return {url:url.href,options:{method:'POST',mode:'cors',credentials:'omit',redirect:'error',referrerPolicy:'no-referrer',headers:{'api-key':stt.key.trim()},body}};
}
