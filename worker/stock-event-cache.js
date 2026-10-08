export async function stockEventCacheRoute(req,{sql,reply,user,randomToken}){
 if(new URL(req.url).pathname!=='/stock-event-cache')return null;
 if(!user?.id)return reply({error:'請先登入'},401);
 if(req.method!=='POST')return reply({error:'Method not allowed'},405);
 const raw=await req.text();if(new TextEncoder().encode(raw).length>150000)return reply({error:'分析结果過大'},413);
 let b;try{b=JSON.parse(raw);}catch{return reply({error:'Invalid JSON'},400);}
 if(!/^[a-f0-9]{64}$/.test(b.key||'')||!['read','claim','save','release'].includes(b.action))return reply({error:'Invalid cache request'},400);
 await sql('CREATE TABLE IF NOT EXISTS stock_event_cache(user_id TEXT NOT NULL,key TEXT NOT NULL,answer TEXT,lease TEXT,expires_at INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(user_id,key))').run();
 const row=await sql('SELECT answer,lease,expires_at FROM stock_event_cache WHERE user_id=? AND key=?',user.id,b.key).first();
 if(b.action==='read')return reply({owner_id:user.id,answer:row?.answer||''});
 if(b.action==='claim'){
  if(row?.answer)return reply({owner_id:user.id,answer:row.answer});
  const lease=randomToken(),now=Date.now();
  const changed=await sql('INSERT INTO stock_event_cache(user_id,key,lease,expires_at) VALUES(?,?,?,?) ON CONFLICT(user_id,key) DO UPDATE SET lease=excluded.lease,expires_at=excluded.expires_at WHERE stock_event_cache.answer IS NULL AND stock_event_cache.expires_at<? RETURNING lease',user.id,b.key,lease,now+3600000,now).first();
  return reply({owner_id:user.id,lease:changed?.lease||null,busy:!changed});
 }
 if(typeof b.lease!=='string'||!b.lease)return reply({error:'Invalid lease'},400);
 if(b.action==='save'){
  if(typeof b.answer!=='string'||!b.answer.trim())return reply({error:'Invalid answer'},400);
  const changed=await sql('UPDATE stock_event_cache SET answer=?,lease=NULL,expires_at=0 WHERE user_id=? AND key=? AND lease=? AND expires_at>? RETURNING key',b.answer,user.id,b.key,b.lease,Date.now()).first();
  return changed?reply({ok:true,owner_id:user.id}):reply({error:'分析工作已到期，請重試'},409);
 }
 await sql('DELETE FROM stock_event_cache WHERE user_id=? AND key=? AND lease=? AND answer IS NULL',user.id,b.key,b.lease).run();return reply({ok:true});
}
