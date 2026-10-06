const LIMIT=1500000;
export function publicTranscriptURL(value){try{const u=new URL(value);if(u.protocol!=='https:'||u.username||u.password||u.port||!u.hostname.includes('.')||u.hostname.includes(':')||/^[\d.]+$/.test(u.hostname)||/(^|\.)(localhost|local|internal|test|invalid)$/.test(u.hostname))return '';return u.href;}catch{return '';}}
export function transcriptLink(item){const nodes=Array.from(item.getElementsByTagNameNS?.('https://podcastindex.org/namespace/1.0','transcript')||[]);return nodes.map(n=>({url:publicTranscriptURL(n.getAttribute('url')),type:n.getAttribute('type')||''})).filter(n=>n.url).sort((a,b)=>(/json|plain|vtt|subrip/i.test(b.type)?1:0)-(/json|plain|vtt|subrip/i.test(a.type)?1:0))[0]?.url||'';}
export function transcriptText(raw,type='',url=''){
 if(new TextEncoder().encode(raw).length>LIMIT)throw Error('來源逐字稿超過 1.5 MB');
 let text=String(raw).replace(/^\uFEFF/,'');
 if(/json/i.test(type)||/\.json(?:\?|$)/i.test(url)||/^\s*[\[{]/.test(text)){
  const data=JSON.parse(text),segments=Array.isArray(data)?data:data.segments||data.results||data.transcript?.segments;
  if(Array.isArray(segments))text=segments.map(s=>{const start=Number(s.startTime??s.start),end=Number(s.endTime??s.end);return (Number.isFinite(start)&&Number.isFinite(end)?`[${(start/60).toFixed(2)}～${(end/60).toFixed(2)} 分鐘]\n`:'')+String(s.body??s.text??s.transcript??'');}).join('\n\n');
  else text=typeof data.text==='string'?data.text:typeof data.transcript==='string'?data.transcript:'';
 }else if(/html/i.test(type)||/^\s*(?:<!doctype html|<html)/i.test(text))throw Error('來源提供的是網頁，未取得可用逐字稿');
 if(!text.trim()||text.length>300000)throw Error('來源逐字稿為空或超過字數上限');
 return text.trim();
}
export async function readSourceTranscript(url,{fetcher=globalThis.fetch,base=String(import.meta.env?.VITE_WORKER_API_URL||'').replace(/\/$/,'')}={}){
 url=publicTranscriptURL(url);if(!url)throw Error('逐字稿連結必須是公開 HTTPS 網址');
 const read=async target=>{const r=await fetcher(target,{credentials:'omit',redirect:'error',signal:AbortSignal.timeout(20000),headers:{Accept:'text/plain, text/vtt, application/json, application/x-subrip'}});if(!r.ok)throw Error('來源逐字稿 HTTP '+r.status);let raw='';if(r.body?.getReader){const reader=r.body.getReader(),decoder=new TextDecoder();let size=0;while(true){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>LIMIT){await reader.cancel();throw Error('來源逐字稿超過 1.5 MB');}raw+=decoder.decode(part.value,{stream:true});}raw+=decoder.decode();}else raw=await r.text();return transcriptText(raw,r.headers?.get('Content-Type')||'',url);};
 try{return await read(url);}catch(error){if(!base)throw error;return read(base+'/podcasts/transcript?url='+encodeURIComponent(url));}
}
