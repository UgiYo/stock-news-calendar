export async function summaryCacheRoute(req,{sql,reply,user,randomToken}){
 if(req.method!=='POST')return reply({error:'Method not allowed'},405);
 const raw=await req.text();if(raw.length>65000)return reply({error:'Too large'},413);
 let b;try{b=JSON.parse(raw);}catch{return reply({error:'Invalid JSON'},400);}
 if(!b||Object.keys(b).some(k=>!['key','action','lease','answer'].includes(k))||!/^[a-f0-9]{64}$/.test(b.key)||!['claim','save','release'].includes(b.action))return reply({error:'Invalid cache request'},400);
 await sql('CREATE TABLE IF NOT EXISTS summary_cache(key TEXT PRIMARY KEY,answer TEXT,owner TEXT,lease TEXT,expires INTEGER NOT NULL)').run();
 const now=Date.now();
 if(b.action==='claim'){
  await sql('DELETE FROM summary_cache WHERE expires<?',now).run();
  const lease=randomToken();
  await sql('INSERT INTO summary_cache(key,owner,lease,expires) VALUES(?,?,?,?) ON CONFLICT(key) DO UPDATE SET answer=NULL,owner=excluded.owner,lease=excluded.lease,expires=excluded.expires WHERE summary_cache.expires<?',b.key,user.id,lease,now+10*60000,now).run();
  const row=await sql('SELECT answer,lease FROM summary_cache WHERE key=?',b.key).first();
  return reply(row.answer?{answer:row.answer,cached:true}:row.lease===lease?{lease}:{pending:true});
 }
 if(typeof b.lease!=='string')return reply({error:'Missing lease'},400);
 if(b.action==='release'){await sql('DELETE FROM summary_cache WHERE key=? AND owner=? AND lease=? AND answer IS NULL',b.key,user.id,b.lease).run();return reply({ok:true});}
 if(typeof b.answer!=='string'||!b.answer.trim()||b.answer.length>60000)return reply({error:'Invalid summary'},400);
 const row=await sql('UPDATE summary_cache SET answer=?,owner=NULL,lease=NULL,expires=? WHERE key=? AND owner=? AND lease=? AND expires>? RETURNING key',b.answer,now+30*86400000,b.key,user.id,b.lease,now).first();
 return row?reply({ok:true}):reply({error:'Cache lease expired'},409);
}
