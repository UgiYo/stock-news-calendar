const cache=new Map();
const key=who=>'stock-ai-notifications-v1:'+encodeURIComponent(who);
const terminal=row=>row&&!['running','queued'].includes(row.state);
export function notificationVersion(row){let hash=2166136261;const text=JSON.stringify([row.completed_at||row.updated_at,row.state,row.answer||'',row.text||'',!!row.partial,row.state==='interrupted'?row.progress||'':'']);for(let i=0;i<text.length;i++)hash=Math.imul(hash^text.charCodeAt(i),16777619);return (hash>>>0).toString(36);}
function read(who){try{return JSON.parse(globalThis.localStorage?.getItem(key(who)))||cache.get(who)||{};}catch{return cache.get(who)||{};}}
function write(who,value){cache.set(who,value);try{globalThis.localStorage?.setItem(key(who),JSON.stringify(value));}catch{}}
const rowKey=row=>JSON.stringify([row.owner,row.id]);
export function notificationInfo(row,who){const info=read(who)[rowKey(row)];return info?.version===notificationVersion(row)?info:{version:notificationVersion(row),generated_at:row.completed_at||row.updated_at,read_at:row.read_at||null,cleared:false,toasted:false};}
function update(row,who,changes){const value=read(who),info={...notificationInfo(row,who),...changes};value[rowKey(row)]=info;write(who,value);return info;}
export function readNotification(row,who){update(row,who,{read_at:new Date().toISOString()});}
export function clearNotification(row,who){update(row,who,{cleared:true});}
export function claimNotificationToast(row,who,{visible=true,openedAt=0}={}){if(!terminal(row))return false;const info=notificationInfo(row,who);if(info.toasted||info.cleared||info.read_at)return false;update(row,who,{toasted:true});return visible&&Date.parse(info.generated_at)>=openedAt;}
