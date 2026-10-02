
function xmlText(value){return String(value||'').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,'$1').replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi,(_,entity)=>{const named={amp:'&',lt:'<',gt:'>',quot:'"',apos:"'"};if(named[entity])return named[entity];const n=entity.startsWith('#x')?parseInt(entity.slice(2),16):Number(entity.slice(1));return n>0&&n<=0x10ffff?String.fromCodePoint(n):'';});}
export function parsePreview(xml,company,now=new Date()){
 if(!/<channel[\s>]/.test(xml))throw Error('Invalid news feed');
 const start=new Date(now);const day=start.getUTCDate();start.setUTCDate(1);start.setUTCMonth(start.getUTCMonth()-1);start.setUTCDate(Math.min(day,new Date(Date.UTC(start.getUTCFullYear(),start.getUTCMonth()+1,0)).getUTCDate()));
 const rows=new Map();for(const match of xml.matchAll(/<item[\s>]([\s\S]*?)<\/item>/g)){
 const tag=name=>xmlText(match[1].match(new RegExp('<'+name+'(?:\\s[^>]*)?>([\\s\\S]*?)<\\/'+name+'>'))?.[1]);
 const title=tag('title'),link=tag('link'),published=new Date(tag('pubDate'));
 if(!title.includes(company.name)&&!(company.full_name&&title.includes(company.full_name))&&!new RegExp('(?<!\\d)'+company.code+'(?!\\d)').test(title))continue;
 if(!Number.isFinite(published.getTime())||published<start||published>now)continue;
 try{if(new URL(link).protocol!=='https:')continue;}catch{continue;}
 rows.set(link,{company_code:company.code,title,url:link,source:tag('source')||'未知來源',published_at:published.toISOString(),news_date:new Date(published.getTime()+8*3600000).toISOString().slice(0,10),preview:true});
 }return [...rows.values()].sort((a,b)=>b.published_at.localeCompare(a.published_at));
}
const encoder=new TextEncoder();
export const randomToken=()=>Array.from(crypto.getRandomValues(new Uint8Array(32)),x=>x.toString(16).padStart(2,'0')).join('');
export async function hash(value){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(value))),x=>x.toString(16).padStart(2,'0')).join('');}
const b64=s=>Uint8Array.from(atob(s.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));
export async function verifyGoogle(token,clientID){
 const [head,body,sig]=token.split('.');if(!head||!body||!sig)throw Error('Invalid identity token');
 const header=JSON.parse(new TextDecoder().decode(b64(head))),claims=JSON.parse(new TextDecoder().decode(b64(body)));
 if(header.alg!=='RS256'||!['accounts.google.com','https://accounts.google.com'].includes(claims.iss)||claims.aud!==clientID||claims.exp<=Date.now()/1000||!claims.sub||claims.email_verified!==true)throw Error('Invalid identity token');
 const response=await fetch('https://www.googleapis.com/oauth2/v3/certs',{signal:AbortSignal.timeout(10000)});if(!response.ok)throw Error('Google identity unavailable');
 const jwk=(await response.json()).keys.find(k=>k.kid===header.kid);if(!jwk)throw Error('Invalid signing key');
 const key=await crypto.subtle.importKey('jwk',jwk,{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['verify']);
 if(!await crypto.subtle.verify('RSASSA-PKCS1-v1_5',key,b64(sig),encoder.encode(head+'.'+body)))throw Error('Invalid signature');return claims;
}
async function dispatch(env){if(!env.GITHUB_DISPATCH_TOKEN)throw Error('Pages Production 尚未設定 GITHUB_DISPATCH_TOKEN');if(!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(env.GITHUB_REPO||''))throw Error('GITHUB_REPO 格式錯誤，應為 UgiYo/stock-news-calendar');const r=await fetch(`https://api.github.com/repos/${env.GITHUB_REPO}/actions/workflows/news.yml/dispatches`,{method:'POST',headers:{Authorization:`Bearer ${env.GITHUB_DISPATCH_TOKEN}`,'User-Agent':'stock-news-calendar','Accept':'application/vnd.github+json','Content-Type':'application/json'},body:JSON.stringify({ref:'main',inputs:{mode:'queued'}}),signal:AbortSignal.timeout(10000)});if(!r.ok){const reason={401:'token 無效或已過期',403:'token 權限不足，需 Actions: Read and write；或 GitHub 存取限制',404:'repo、news.yml 不存在，或 token 未獲授權存取此 repo',422:'workflow 的 main 分支或 workflow_dispatch 設定不符'};throw Error('GitHub HTTP '+r.status+'：'+(reason[r.status]||'啟動請求失敗'));}return true;}
export default {async fetch(req,env){
 const url=new URL(req.url),path=url.pathname;
 let appURL;
 try{appURL=new URL(String(env.APP_URL||'').trim());if(!['https:','http:'].includes(appURL.protocol)||appURL.username||appURL.password||appURL.search||appURL.hash)throw Error('Invalid APP_URL');if(!appURL.pathname.endsWith('/'))appURL.pathname+='/';}
 catch{return Response.json({error:'APP_URL 尚未設定或格式錯誤。請在 Worker Settings → Variables and Secrets 新增 Text 變數 APP_URL，值為 https://ugiyo.github.io/stock-news-calendar/，儲存並重新部署。'},{status:503,headers:{'Cache-Control':'no-store'}});}
 const origin=appURL.origin;
 const headers={'Content-Type':'application/json','Access-Control-Allow-Origin':origin,'Access-Control-Allow-Headers':'authorization,content-type','Access-Control-Allow-Methods':'GET,POST,DELETE,OPTIONS','Cache-Control':'no-store','Vary':'Origin'};
 const reply=(data,status=200)=>Response.json(data,{status,headers});
 const sql=(q,...args)=>env.DB.prepare(q).bind(...args);
 try{
 if(req.method==='OPTIONS')return new Response(null,{headers});
 if(req.headers.get('Origin')&&req.headers.get('Origin')!==origin)return reply({error:'Origin not allowed'},403);
 if(path==='/health'){const missing=['DB','GOOGLE_CLIENT_ID','GOOGLE_CLIENT_SECRET','COLLECTOR_SECRET'].filter(k=>!env[k]);return reply({ok:missing.length===0,missing},missing.length?503:200);}
 if(path==='/auth/start'){
 const state=randomToken(),verifier=randomToken();await sql('DELETE FROM oauth_states WHERE expires_at<?',Date.now()).run();
 await sql('INSERT INTO oauth_states VALUES(?,?,?)',state,verifier,Date.now()+600000).run();
 const challenge=await crypto.subtle.digest('SHA-256',encoder.encode(verifier));const encoded=btoa(String.fromCharCode(...new Uint8Array(challenge))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
 const params=new URLSearchParams({client_id:env.GOOGLE_CLIENT_ID,redirect_uri:url.origin+'/auth/callback',response_type:'code',scope:'openid email profile',state,code_challenge:encoded,code_challenge_method:'S256',prompt:'select_account'});
 return new Response(null,{status:302,headers:{Location:'https://accounts.google.com/o/oauth2/v2/auth?'+params,'Set-Cookie':`oauth_state=${state}; Secure; HttpOnly; SameSite=Lax; Max-Age=600; Path=/auth`}});
 }
 if(path==='/auth/callback'){
 const state=url.searchParams.get('state'),cookie=req.headers.get('Cookie')||'';
 if(!state||!cookie.split(';').some(x=>x.trim()==='oauth_state='+state))return reply({error:'Invalid OAuth state'},400);
 const row=await sql('DELETE FROM oauth_states WHERE state=? AND expires_at>? RETURNING *',state,Date.now()).first();if(!row)return reply({error:'OAuth request expired'},400);
 if(!url.searchParams.get('code'))return new Response(null,{status:302,headers:{Location:appURL.href+'#login_error=cancelled'}});
 const response=await fetch('https://oauth2.googleapis.com/token',{method:'POST',body:new URLSearchParams({code:url.searchParams.get('code'),client_id:env.GOOGLE_CLIENT_ID,client_secret:env.GOOGLE_CLIENT_SECRET,redirect_uri:url.origin+'/auth/callback',grant_type:'authorization_code',code_verifier:row.verifier}),signal:AbortSignal.timeout(15000)});
 if(!response.ok)throw Error('Google login failed');const identity=await verifyGoogle((await response.json()).id_token,env.GOOGLE_CLIENT_ID);
 await sql('INSERT INTO users VALUES(?,?) ON CONFLICT(id) DO UPDATE SET email=excluded.email',identity.sub,identity.email).run();
 const token=randomToken();await sql('DELETE FROM sessions WHERE expires_at<?',Date.now()).run();await sql('INSERT INTO sessions VALUES(?,?,?)',await hash(token),identity.sub,Date.now()+30*86400000).run();
 return new Response(null,{status:302,headers:{Location:appURL.href+'#session='+token,'Set-Cookie':'oauth_state=; Secure; HttpOnly; SameSite=Lax; Max-Age=0; Path=/auth','Cache-Control':'no-store','Referrer-Policy':'no-referrer'}});
 }
 if(path.startsWith('/admin/')){
 const provided=req.headers.get('Authorization')||'';if(!env.COLLECTOR_SECRET||await hash(provided)!==await hash('Bearer '+env.COLLECTOR_SECRET))return reply({error:'Forbidden'},403);
 if(path==='/admin/companies'&&req.method==='POST'){const {companies}=await req.json();if(!Array.isArray(companies)||companies.length>100)return reply({error:'Invalid batch'},400);await env.DB.batch(companies.map(c=>{if(!/^\d{4,6}$/.test(c.code)||!c.name||!['上市','上櫃'].includes(c.market))throw Error('Invalid company');return sql('INSERT INTO companies(code,name,full_name,market) VALUES(?,?,?,?) ON CONFLICT(code) DO UPDATE SET name=excluded.name,full_name=excluded.full_name,market=excluded.market',c.code,c.name,c.full_name,c.market);}));return reply({ok:true});}
 if(path==='/admin/tracked')return reply({companies:(await sql('SELECT DISTINCT c.* FROM companies c JOIN watchlists w ON c.code=w.company_code').all()).results});
 if(path==='/admin/claim'&&req.method==='POST'){
 await sql("UPDATE jobs SET status='pending' WHERE status='running' AND claimed_at<?",Date.now()-20*60000).run();
 const jobs=(await sql("UPDATE jobs SET status='running',claimed_at=? WHERE id IN (SELECT id FROM jobs WHERE status='pending' ORDER BY created_at LIMIT 1) RETURNING *",Date.now()).all()).results;return reply({jobs});}
 if(path==='/admin/job'&&req.method==='POST'){const b=await req.json();await sql('UPDATE jobs SET status=?,error=? WHERE id=?',b.error?'failed':'done',b.error||null,b.id).run();return reply({ok:true});}
 if(path==='/admin/news'&&req.method==='POST'){const b=await req.json();if(!Array.isArray(b.news)||b.news.length>50)return reply({error:'Invalid batch'},400);await env.DB.batch(b.news.map(n=>{if(!/^\d{4,6}$/.test(n.company_code)||!/^https:\/\//.test(n.url)||!/^\d{4}-\d{2}-\d{2}$/.test(n.news_date))throw Error('Invalid news');return sql('INSERT INTO news(company_code,title,url,source,published_at,news_date) VALUES(?,?,?,?,?,?) ON CONFLICT(company_code,url) DO UPDATE SET title=excluded.title,source=excluded.source,published_at=excluded.published_at,news_date=excluded.news_date',n.company_code,n.title,n.url,n.source,n.published_at,n.news_date);}));return reply({ok:true});}
 if(path==='/admin/company'&&req.method==='POST'){const b=await req.json();await sql('UPDATE companies SET last_collected_at=COALESCE(?,last_collected_at),last_error=? WHERE code=?',b.updated_at||null,b.error||null,b.code).run();return reply({ok:true});}
 if(path==='/admin/article')return reply({news:await sql('SELECT * FROM news WHERE id=?',url.searchParams.get('id')).first()});
 if(path==='/admin/summary'&&req.method==='POST'){const b=await req.json();await sql('UPDATE news SET article_summary=?,summary_status=?,summary_method=?,summary_error=?,summary_updated_at=?,article_url=? WHERE id=?',b.article_summary||null,b.article_summary?'ready':'unavailable',b.summary_method||null,b.summary_error||null,new Date().toISOString(),b.article_url||null,b.id).run();return reply({ok:true});}
 return reply({error:'Not found'},404);
 }
 const token=req.headers.get('Authorization')?.replace(/^Bearer /,'');if(!token)return reply({error:'請先登入'},401);
 const user=await sql('SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>?',await hash(token),Date.now()).first();if(!user)return reply({error:'登入已過期，請重新登入'},401);
 if(path==='/me')return reply({user});
 if(path==='/logout'&&req.method==='POST'){await sql('DELETE FROM sessions WHERE token_hash=?',await hash(token)).run();return reply({ok:true});}
 if(path==='/companies'){const q=(url.searchParams.get('q')||'').trim().slice(0,60);return reply({companies:(await sql("SELECT * FROM companies WHERE code=? OR instr(name,?)>0 OR instr(full_name,?)>0 ORDER BY code LIMIT 20",q,q,q).all()).results});}
 if(path==='/preview'&&req.method==='GET'){
 const code=url.searchParams.get('code');if(!/^\d{4,6}$/.test(code||''))return reply({error:'股號格式錯誤'},400);
 const company=await sql('SELECT * FROM companies WHERE code=?',code).first();if(!company)return reply({error:'公司不存在'},404);
 const feed=new URL('https://news.google.com/rss/search');feed.search=new URLSearchParams({q:`("${company.name}" OR "${company.full_name}" OR "${code}") when:1m`,hl:'zh-TW',gl:'TW',ceid:'TW:zh-Hant'}).toString();
 const response=await fetch(feed,{headers:{'User-Agent':'StockNewsCalendar/2.0'},signal:AbortSignal.timeout(20000)});if(!response.ok)return reply({error:'新聞來源暫時無法讀取，請稍後重試'},502);
 return reply({company,news:parsePreview(await response.text(),company)});
 }
 if(path==='/watchlists'&&req.method==='GET')return reply({companies:(await sql('SELECT c.* FROM companies c JOIN watchlists w ON c.code=w.company_code WHERE w.user_id=? ORDER BY w.created_at,c.code',user.id).all()).results});
 if(path==='/watchlists'&&req.method==='POST'){const {code}=await req.json();if(!await sql('SELECT code FROM companies WHERE code=?',code).first())return reply({error:'公司不存在'},404);await sql('INSERT OR IGNORE INTO watchlists(user_id,company_code) VALUES(?,?)',user.id,code).run();return reply({ok:true});}
 if(path==='/watchlists'&&req.method==='DELETE'){await sql('DELETE FROM watchlists WHERE user_id=? AND company_code=?',user.id,url.searchParams.get('code')).run();return reply({ok:true});}
 if(path==='/news'){
 const from=url.searchParams.get('from'),to=url.searchParams.get('to'),offset=Number(url.searchParams.get('offset')||0);if(!/^\d{4}-\d{2}-\d{2}$/.test(from)||!/^\d{4}-\d{2}-\d{2}$/.test(to)||!Number.isSafeInteger(offset)||offset<0)return reply({error:'Invalid range'},400);
 return reply({news:(await sql('SELECT n.* FROM news n JOIN watchlists w ON w.company_code=n.company_code WHERE w.user_id=? AND n.news_date BETWEEN ? AND ? ORDER BY n.published_at DESC,n.id DESC LIMIT 500 OFFSET ?',user.id,from,to,offset).all()).results});
 }
 if((path==='/collect'||path==='/summarize')&&req.method==='POST'){
 const b=await req.json(),type=path.slice(1);let code=b.code,news;
 if(type==='summarize'){news=await sql('SELECT * FROM news WHERE id=?',b.id).first();if(!news)return reply({error:'新聞不存在'},404);code=news.company_code;}
 if(!await sql('SELECT 1 FROM watchlists WHERE user_id=? AND company_code=?',user.id,code).first())return reply({error:'尚未追蹤此公司'},403);
 if(news?.article_summary)return reply({news});
 const existing=await sql("SELECT * FROM jobs WHERE type=? AND company_code=? AND news_id IS ? AND status IN ('pending','running') ORDER BY created_at DESC LIMIT 1",type,code,news?.id||null).first();
 if(existing){let dispatched,dispatchError;if(existing.status==='pending'){dispatched=false;try{dispatched=await dispatch(env);}catch(e){dispatchError=e.message||'GitHub 連線失敗';}}return reply({job:existing,news,dispatched,dispatchError},202);}
 const recent=await sql("SELECT * FROM jobs WHERE type=? AND company_code=? AND news_id IS ? AND created_at>? ORDER BY created_at DESC LIMIT 1",type,code,news?.id||null,Date.now()-15*60000).first();if(recent?.status==='done')return reply({job:recent,news},202);
 const id=randomToken();await sql('INSERT OR IGNORE INTO jobs(id,type,company_code,news_id,created_at) VALUES(?,?,?,?,?)',id,type,code,news?.id||null,Date.now()).run();
 const queued=await sql("SELECT id,status FROM jobs WHERE type=? AND company_code=? AND news_id IS ? AND status IN ('pending','running') LIMIT 1",type,code,news?.id||null).first();
 let dispatched=false,dispatchError;try{dispatched=await dispatch(env);}catch(e){dispatchError=e.message||'GitHub 連線失敗';}return reply({job:queued,news,dispatched,dispatchError},202);
 }
 if(path==='/jobs'){const j=await sql('SELECT j.* FROM jobs j JOIN watchlists w ON w.company_code=j.company_code WHERE j.id=? AND w.user_id=?',url.searchParams.get('id'),user.id).first();if(!j)return reply({error:'Job not found'},404);return reply({job:j,news:j.news_id?await sql('SELECT * FROM news WHERE id=?',j.news_id).first():undefined});}
 return reply({error:'Not found'},404);
 }catch(e){console.error(e.message);return reply({error:'服務暫時無法使用，請檢查後端設定'},500);}
}};
