export function publicHost(host:string){
 const h=host.toLowerCase();
 // Reject all IP literals and single-label/internal hostnames. DNS is checked separately.
 return h.includes('.')&&!h.includes(':')&&!/^[\d.]+$/.test(h)&&!/(^|\.)(localhost|local|internal|test|invalid)$/.test(h);
}
export function publicIPv4(ip:string){const p=ip.split('.').map(Number);return p.length===4&&p.every(n=>Number.isInteger(n)&&n>=0&&n<=255)&&![0,10,127].includes(p[0])&&!(p[0]===169&&p[1]===254)&&!(p[0]===172&&p[1]>=16&&p[1]<=31)&&!(p[0]===192&&p[1]===168)&&!(p[0]===100&&p[1]>=64&&p[1]<=127)&&p[0]<224;}
export function extractive(text:string){
 const sentences=text.replace(/\s+/g,' ').match(/[^。！？.!?]+[。！？.!?]?/g)||[];
 const clean=sentences.map(s=>s.trim()).filter(s=>s.length>15);
 // Sample the full body, preserving original order; explicitly labeled extraction, not AI analysis.
 const indexes=[0,1,Math.floor(clean.length/3),Math.floor(clean.length*2/3),clean.length-1];
 return [...new Set(indexes)].filter(i=>i>=0&&i<clean.length).sort((a,b)=>a-b).map(i=>'• '+clean[i].slice(0,220)).join('\n');
}
export function rpcPublisher(response:string){
 for(const line of response.split('\n')){if(!line.trim().startsWith('['))continue;try{
 const batch=JSON.parse(line);for(const item of batch){if(item?.[1]!=='Fbv4je'||typeof item[2]!=='string')continue;const payload=JSON.parse(item[2]);if(payload?.[0]==='garturlres'&&typeof payload[1]==='string'&&payload[1].startsWith('https://'))return payload[1];}
 }catch{/* Ignore framing lengths and unrelated RPC frames. */}}
 throw Error('無法解析 Google News 原文網址');
}
export function googleRequest(id:string,timestamp:number,signature:string){
 const context=[['zh-TW','TW',['FINANCE_TOP_INDICES','WEB_TEST_1_0_0'],null,null,1,1,'TW:zh-Hant',null,360,null,null,null,null,null,0,null,null,null],'zh-TW','TW',1,[2,3,4,8],1,0,'',0,0,null,0];
 return JSON.stringify([[['Fbv4je',JSON.stringify(['garturlreq',context,id,timestamp,signature]),null,'generic']]]);
}
