const FEATURE_TREE=[
 {key:'news_calendar',label:'新聞月曆',children:[
  {key:'news_calendar.news',label:'新聞與日期摘要'},
  {key:'news_calendar.podcast',label:'Podcast 日曆與提及追蹤股'}
 ]},
 {key:'market_watch',label:'市場觀察',children:[
  {key:'market_watch.turnover',label:'成交值排行與產業趨勢'},
  {key:'market_watch.observation',label:'優先觀察股與價值鏈'},
  {key:'market_watch.stock_events',label:'個股異動追查'}
 ]},
 {key:'stock_tools',label:'個股工具',children:[
  {key:'stock_tools.candles',label:'K 線'},
  {key:'stock_tools.broker_reports',label:'券商報告'}
 ]},
 {key:'ai_tools',label:'AI 工具',children:[
  {key:'ai_tools.assistant',label:'AI 小助手'},
  {key:'ai_tools.results',label:'AI 成果中心與通知'}
 ]}
];
const ALL_KEYS=FEATURE_TREE.flatMap(x=>[x.key,...x.children.map(y=>y.key)]);
const json=(data,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store'}});
const tokenOf=req=>(req.headers.get('Authorization')||'').replace(/^Bearer /,'').trim();
export async function managementRoute(req,env,{sql,reply,randomToken,user}){
 const {pathname:path}=new URL(req.url);
 if(path==='/admin/login'&&req.method==='POST'){
  if(!env.ADMIN_USERNAME||!env.ADMIN_PASSWORD)return reply({error:'管理者帳密尚未設定，請在 Worker Secrets 設定 ADMIN_USERNAME 與 ADMIN_PASSWORD'},503);
  await sql('CREATE TABLE IF NOT EXISTS admin_login_attempts (ip_hash TEXT PRIMARY KEY, count INTEGER NOT NULL, window_started INTEGER NOT NULL)').run();
  const ip=(req.headers.get('CF-Connecting-IP')||'unknown').slice(0,80),ipHash=await hash(ip),now=Date.now();
  const attempt=await sql('SELECT count,window_started FROM admin_login_attempts WHERE ip_hash=?',ipHash).first();
  if(attempt&&now-attempt.window_started<15*60_000&&attempt.count>=8)return reply({error:'登入嘗試過多，請 15 分鐘後重試'},429);
  const body=await req.json().catch(()=>({})),username=String(body.username||''),password=String(body.password||'');
  const valid=constantEqual(await hash(username),await hash(env.ADMIN_USERNAME))&&constantEqual(await hash(password),await hash(env.ADMIN_PASSWORD));
  if(!valid){
   if(attempt&&now-attempt.window_started<15*60_000)await sql('UPDATE admin_login_attempts SET count=count+1 WHERE ip_hash=?',ipHash).run();
   else await sql('INSERT INTO admin_login_attempts(ip_hash,count,window_started) VALUES(?,1,?) ON CONFLICT(ip_hash) DO UPDATE SET count=1,window_started=excluded.window_started',ipHash,now).run();
   return reply({error:'帳號或密碼錯誤'},401);
  }
  await sql('DELETE FROM admin_login_attempts WHERE ip_hash=?',ipHash).run();
  await sql('CREATE TABLE IF NOT EXISTS admin_sessions (token_hash TEXT PRIMARY KEY, expires_at INTEGER NOT NULL)').run();
  const token=randomToken();await sql('DELETE FROM admin_sessions WHERE expires_at<?',now).run();await sql('INSERT INTO admin_sessions VALUES(?,?)',await hash(token),now+8*60*60_000).run();
  return reply({token,expiresAt:now+8*60*60_000});
 }
 if(path==='/admin/logout'&&req.method==='POST'){
  const token=tokenOf(req);if(token)await sql('DELETE FROM admin_sessions WHERE token_hash=?',await hash(token)).run();return reply({ok:true});
 }
 if(path==='/features'&&req.method==='GET'){
  if(!user)return reply({error:'請先登入'},401);
  await ensureTables(sql);
  const flags=await sql('SELECT feature_key,enabled FROM feature_flags').all();
  const overrides=await sql('SELECT feature_key,enabled FROM user_feature_overrides WHERE user_id=?',user.id).all();
  return reply({features:effectiveFlags(flags.results,overrides.results)});
 }
 if(!path.startsWith('/management'))return null;
 const token=tokenOf(req);if(!token)return reply({error:'管理者尚未登入'},401);
 await sql('CREATE TABLE IF NOT EXISTS admin_sessions (token_hash TEXT PRIMARY KEY, expires_at INTEGER NOT NULL)').run();
 const session=await sql('SELECT expires_at FROM admin_sessions WHERE token_hash=? AND expires_at>?',await hash(token),Date.now()).first();
 if(!session)return reply({error:'管理者登入已過期，請重新登入'},401);
 await ensureTables(sql);
 if(path==='/management'&&req.method==='GET'){
  const [flags,users,overrides]=await Promise.all([
   sql('SELECT feature_key,enabled FROM feature_flags').all(),
   sql('SELECT u.id,u.email,m.blacklisted,m.first_login_at,m.last_login_at FROM users u LEFT JOIN managed_users m ON m.user_id=u.id ORDER BY COALESCE(m.last_login_at,0) DESC LIMIT 500').all(),
   sql('SELECT user_id,feature_key,enabled FROM user_feature_overrides').all()
  ]);
  return reply({tree:FEATURE_TREE,features:effectiveFlags(flags.results,[]),users:users.results.map(u=>({...u,blacklisted:!!u.blacklisted})),overrides:overrides.results.map(o=>({...o,enabled:!!o.enabled}))});
 }
 if(path==='/management/features'&&req.method==='PUT'){
  const body=await req.json().catch(()=>({}));
  if(!Array.isArray(body.features)||body.features.length>ALL_KEYS.length||body.features.some(f=>!ALL_KEYS.includes(f.key)||typeof f.enabled!=='boolean'))return reply({error:'功能設定格式錯誤'},400);
  for(const f of body.features)await sql('INSERT INTO feature_flags(feature_key,enabled,updated_at) VALUES(?,?,?) ON CONFLICT(feature_key) DO UPDATE SET enabled=excluded.enabled,updated_at=excluded.updated_at',f.key,f.enabled,Date.now()).run();
  return reply({ok:true});
 }
 const userFeatures=path.match(/^\/management\/users\/([^/]+)\/features$/);
 if(userFeatures&&req.method==='PUT'){
  const userId=decodeURIComponent(userFeatures[1]);if(!await sql('SELECT id FROM users WHERE id=?',userId).first())return reply({error:'找不到使用者'},404);
  const body=await req.json().catch(()=>({}));if(!ALL_KEYS.includes(body.key)||!(typeof body.enabled==='boolean'||body.enabled===null))return reply({error:'使用者功能設定格式錯誤'},400);
  if(body.enabled===null)await sql('DELETE FROM user_feature_overrides WHERE user_id=? AND feature_key=?',userId,body.key).run();
  else await sql('INSERT INTO user_feature_overrides(user_id,feature_key,enabled,updated_at) VALUES(?,?,?,?) ON CONFLICT(user_id,feature_key) DO UPDATE SET enabled=excluded.enabled,updated_at=excluded.updated_at',userId,body.key,body.enabled?1:0,Date.now()).run();
  return reply({ok:true});
 }
 const block=path.match(/^\/management\/users\/([^/]+)\/blacklist$/);
 if(block&&req.method==='PUT'){
  const userId=decodeURIComponent(block[1]),body=await req.json().catch(()=>({}));
  if(typeof body.blacklisted!=='boolean'||!await sql('SELECT id FROM users WHERE id=?',userId).first())return reply({error:'黑名單設定格式錯誤或使用者不存在'},400);
  await sql('INSERT INTO managed_users(user_id,blacklisted) VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET blacklisted=excluded.blacklisted',userId,body.blacklisted?1:0).run();
  if(body.blacklisted)await sql('DELETE FROM sessions WHERE user_id=?',userId).run();
  return reply({ok:true});
 }
 return reply({error:'Not found'},404);
}
async function ensureTables(sql){
 await sql('CREATE TABLE IF NOT EXISTS managed_users(user_id TEXT PRIMARY KEY REFERENCES users(id),blacklisted INTEGER NOT NULL DEFAULT 0,first_login_at INTEGER,last_login_at INTEGER)').run();
 await sql('CREATE TABLE IF NOT EXISTS feature_flags(feature_key TEXT PRIMARY KEY,enabled INTEGER NOT NULL,updated_at INTEGER NOT NULL)').run();
 await sql('CREATE TABLE IF NOT EXISTS user_feature_overrides(user_id TEXT NOT NULL REFERENCES users(id),feature_key TEXT NOT NULL,enabled INTEGER NOT NULL,updated_at INTEGER NOT NULL,PRIMARY KEY(user_id,feature_key))').run();
}
function effectiveFlags(flags,overrides){
 const global=Object.fromEntries(flags.map(x=>[x.feature_key,!!x.enabled])),personal=Object.fromEntries(overrides.map(x=>[x.feature_key,!!x.enabled]));
 const out={};for(const key of ALL_KEYS)out[key]=Object.hasOwn(personal,key)?personal[key]:Object.hasOwn(global,key)?global[key]:true;
 for(const node of FEATURE_TREE)out[node.key]=node.children.some(c=>out[c.key]);
 return out;
}
async function hash(value){const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(String(value)));return [...new Uint8Array(bytes)].map(b=>b.toString(16).padStart(2,'0')).join('');}
function constantEqual(a,b){if(a.length!==b.length)return false;let mismatch=0;for(let i=0;i<a.length;i++)mismatch|=a.charCodeAt(i)^b.charCodeAt(i);return mismatch===0;}
