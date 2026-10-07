import {ensureD1Index} from './d1-usage.js';

const schema='CREATE TABLE IF NOT EXISTS ranking_refresh(slot INTEGER PRIMARY KEY CHECK(slot=1),id TEXT NOT NULL,status TEXT NOT NULL,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,data_date TEXT,error TEXT)';
const expiry=25*60_000;
export async function rankingRefreshRoute(req,{sql,reply,db,dispatch,env,admin=false,now=Date.now(),uuid=()=>crypto.randomUUID()}){
 const url=new URL(req.url),path=url.pathname;
 if(path!==(admin?'/admin/ranking-refresh':'/ranking-refresh'))return null;
 if(!['GET','POST'].includes(req.method)||admin&&req.method!=='POST')return reply({error:'Method not allowed'},405);
 await ensureD1Index(db,'ranking_refresh_schema',schema);
 if(admin){
  const body=await req.json();
  if(typeof body.id!=='string'||!['running','done','failed'].includes(body.status)||body.data_date!=null&&!/^\d{4}-\d{2}-\d{2}$/.test(body.data_date))return reply({error:'Invalid ranking update'},400);
  await sql("UPDATE ranking_refresh SET status=?,updated_at=?,data_date=?,error=? WHERE slot=1 AND id=? AND status IN ('pending','running')",body.status,now,body.data_date||null,String(body.error||'').slice(0,500)||null,body.id).run();
  return reply({ok:true});
 }
 let job=await sql('SELECT * FROM ranking_refresh WHERE slot=1').first();
 if(job&&['pending','running'].includes(job.status)&&job.created_at<=now-expiry){
  await sql("UPDATE ranking_refresh SET status='failed',updated_at=?,error=? WHERE slot=1 AND id=? AND status IN ('pending','running')",now,'更新等待逾時，請重新按「立即更新成交值」。',job.id).run();
  job={...job,status:'failed',error:'更新等待逾時，請重新按「立即更新成交值」。'};
 }
 if(req.method==='GET'){
  const id=url.searchParams.get('id');
  if(id&&job?.id!==id)return reply({error:'此更新任務已結束，請重新讀取排行榜。'},404);
  return reply({job});
 }
 if(job&&['pending','running'].includes(job.status))return reply({job},202);
 const id=uuid();
 await sql("INSERT INTO ranking_refresh(slot,id,status,created_at,updated_at) VALUES(1,?,'pending',?,?) ON CONFLICT(slot) DO UPDATE SET id=excluded.id,status='pending',created_at=excluded.created_at,updated_at=excluded.updated_at,data_date=NULL,error=NULL WHERE ranking_refresh.status NOT IN ('pending','running') OR ranking_refresh.created_at<=?",id,now,now,now-expiry).run();
 job=await sql('SELECT * FROM ranking_refresh WHERE slot=1').first();
 if(job.id!==id)return reply({job},202);
 try{
  await dispatch(env,'ranking.yml',{refresh_id:id});
  return reply({job},202);
 }catch(error){
  const message='成交值更新無法啟動，請稍後重試。';
  console.error('Ranking dispatch failed:',error.message);
  await sql("UPDATE ranking_refresh SET status='failed',updated_at=?,error=? WHERE slot=1 AND id=?",now,message,id).run();
  return reply({error:message},502);
 }
}
