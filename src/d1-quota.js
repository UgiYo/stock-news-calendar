export function createQuotaGate({storage,key,now=Date.now}={}){
 let paused=null;try{paused=JSON.parse(storage?.getItem(key)||'null');}catch{}
 return {
  clear(){paused=null;try{storage?.removeItem(key);}catch{}},
  check(){if(paused&&Date.parse(paused.reset_at)>now()){const error=Error(paused.error);error.code=paused.code;error.status=503;throw error;}if(paused){paused=null;try{storage?.removeItem(key);}catch{}}},
  note(data){if(!/^D1_(READ|WRITE)_QUOTA$/.test(data?.code)||!Number.isFinite(Date.parse(data.reset_at)))return;paused={code:data.code,error:data.error,reset_at:data.reset_at};try{storage?.setItem(key,JSON.stringify(paused));}catch{}}
 };
}
export function cloudPollDelay(rows){return rows.some(r=>r.cloud_id&&['running','queued'].includes(r.state))?15000:300000;}
