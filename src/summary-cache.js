import {api} from './api.js';
import {companyMode} from './ai-privacy.js';
export async function cachedSummary(config,text,generate,{shared=false,signal,onProgress=()=>{},call=api,storage=globalThis.localStorage}={}){
 const key=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(['summary-v1',config.provider,config.endpoint,config.model,text])))),x=>x.toString(16).padStart(2,'0')).join('');
 const localKey='summary-cache:'+key;
 try{const answer=storage?.getItem(localKey);if(answer){onProgress('使用此裝置已保存摘要，未呼叫 AI。');return answer;}}catch{}
 // Never contact the shared backend for company gateways or local transports.
 let signedIn=false;try{signedIn=!!storage?.getItem('stock-news-session');}catch{}
 const publicCache=shared&&(signedIn||call!==api)&&!companyMode(config)&&config.transport!=='python'&&config.provider==='openai'&&new URL(config.endpoint).hostname==='api.openai.com';
 let lease;
 if(publicCache){
  let claim;try{claim=await call('/summary-cache',{body:{key,action:'claim'}});}catch{throw Error('共用摘要快取暫時無法使用，請確認 news-calendar-api 已部署最新版，稍後重試；尚未呼叫 AI。');}
  if(claim.answer){onProgress('使用共用快取摘要，未呼叫 AI。');return claim.answer;}
  if(!claim.lease)throw Error('其他使用者正在整理相同內容，請稍後再次點生成，會直接使用已完成的摘要。');
  lease=claim.lease;
 }
 try{
  if(signal?.aborted)throw Error('已取消');
  const answer=await generate();
  try{storage?.setItem(localKey,answer);}catch{}
  if(lease){try{await call('/summary-cache',{body:{key,action:'save',lease,answer}});}catch{onProgress('摘要已完成並留在本機，但共用快取保存失敗。');}}
  return answer;
 }catch(error){if(lease)try{await call('/summary-cache',{body:{key,action:'release',lease}});}catch{}throw error;}
}
