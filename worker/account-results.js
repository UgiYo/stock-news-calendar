const fields=['id','title','kind','date','updated_at','answer','text','partial','failures'];
export function validAccountResult(row){return row&&Object.keys(row).every(k=>fields.includes(k))&&typeof row.id==='string'&&row.id.length>0&&row.id.length<=500&&typeof row.title==='string'&&row.title.length<=1000&&['news','text','podcast'].includes(row.kind)&&typeof row.updated_at==='string'&&/^\d{4}-\d\d-\d\dT/.test(row.updated_at)&&Number.isFinite(Date.parse(row.updated_at))&&typeof row.answer==='string'&&typeof row.text==='string'&&typeof row.date==='string'&&typeof row.partial==='boolean'&&Array.isArray(row.failures)&&row.failures.every(v=>typeof v==='string');}
export async function accountResultsRoute(req,{sql,reply,user}){
 const url=new URL(req.url);if(!['/account-results','/account-news'].includes(url.pathname))return null;
 if(url.pathname==='/account-news'){
  await sql('CREATE TABLE IF NOT EXISTS account_news(user_id TEXT NOT NULL,url TEXT NOT NULL,payload TEXT NOT NULL,PRIMARY KEY(user_id,url))').run();
  if(req.method==='GET')return reply({news:(await sql('SELECT payload FROM account_news WHERE user_id=? LIMIT 2000',user.id).all()).results.map(r=>JSON.parse(r.payload))});
  if(req.method!=='POST')return reply({error:'Method not allowed'},405);
  const raw=await req.text();if(new TextEncoder().encode(raw).length>500000)return reply({error:'新聞同步資料過大'},413);
  let rows;try{rows=JSON.parse(raw);}catch{return reply({error:'Invalid JSON'},400);}
  const keys=['company_code','title','url','source','published_at','news_date'];
  if(!Array.isArray(rows)||rows.length>100||rows.some(r=>!r||Object.keys(r).some(k=>!keys.includes(k))||keys.some(k=>typeof r[k]!=='string')||!/^https?:\/\//.test(r.url)||!/^\d{4,6}$/.test(r.company_code)))return reply({error:'Invalid news'},400);
  for(const row of rows)await sql('INSERT INTO account_news(user_id,url,payload) VALUES(?,?,?) ON CONFLICT(user_id,url) DO UPDATE SET payload=excluded.payload',user.id,row.url,JSON.stringify(row)).run();return reply({ok:true});
 }
 if(!['GET','POST','DELETE'].includes(req.method))return reply({error:'Method not allowed'},405);
 await sql('CREATE TABLE IF NOT EXISTS account_results(user_id TEXT NOT NULL,id TEXT NOT NULL,payload TEXT NOT NULL,updated_at TEXT NOT NULL,PRIMARY KEY(user_id,id))').run();
 if(req.method==='GET'){const rows=(await sql('SELECT id,payload,updated_at FROM account_results WHERE user_id=? ORDER BY updated_at DESC LIMIT 200',user.id).all()).results;return reply({results:rows.filter(r=>!JSON.parse(r.payload).deleted).map(r=>JSON.parse(r.payload)),deleted:rows.filter(r=>JSON.parse(r.payload).deleted).map(r=>({id:r.id,updated_at:r.updated_at}))});}
 if(req.method==='DELETE'){await sql('INSERT INTO account_results(user_id,id,payload,updated_at) VALUES(?,?,?,?) ON CONFLICT(user_id,id) DO UPDATE SET payload=excluded.payload,updated_at=excluded.updated_at',user.id,url.searchParams.get('id'),JSON.stringify({deleted:true}),new Date().toISOString()).run();return reply({ok:true});}
 const raw=await req.text();if(new TextEncoder().encode(raw).length>500000)return reply({error:'成果超過同步大小上限，已保留於此裝置'},413);
 let row;try{row=JSON.parse(raw);}catch{return reply({error:'Invalid JSON'},400);}if(!validAccountResult(row))return reply({error:'僅接受完成成果，不可包含 AI 設定或金鑰'},400);
 await sql('INSERT INTO account_results(user_id,id,payload,updated_at) VALUES(?,?,?,?) ON CONFLICT(user_id,id) DO UPDATE SET payload=excluded.payload,updated_at=excluded.updated_at WHERE excluded.updated_at>account_results.updated_at',user.id,row.id,raw,row.updated_at).run();return reply({ok:true});
}
