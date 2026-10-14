import {DEFAULT_SUBSTACK,substackPublication,substackAuthorInput,substackMentions} from '../shared/substack.js';
import {marketDay} from '../shared/markets.js';
const decode=v=>String(v||'').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,'$1').replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&apos;|&#39;/g,"'").replace(/&#(\d+);/g,(_,n)=>Number(n)<=0x10ffff?String.fromCodePoint(Number(n)):'').replace(/<[^>]*>/g,'').trim();
export function substackProfileCandidates(html){
 const candidates=new Map();
 for(const m of String(html||'').matchAll(/<a\b[^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)){
  try{const link=new URL(decode(m[1]));if(!['','/','/about','/archive'].includes(link.pathname))continue;const url=substackPublication(link.href),title=decode(m[2]).slice(0,500)||new URL(url).hostname.split('.')[0];
   const old=candidates.get(url);if(!old||old.title===new URL(url).hostname.split('.')[0])candidates.set(url,{url,title});
  }catch{}
 }
 return [...candidates.values()].slice(0,20);
}
async function readSubstackSource(url,fetcher){
 const expected=new URL(url);let endpoint=url;
 for(let i=0;i<3;i++){
  const r=await fetcher(endpoint,{redirect:'manual',headers:{'User-Agent':'Mozilla/5.0 (compatible; StockNewsCalendar/1.0)','Accept':'text/html,application/rss+xml'},signal:AbortSignal.timeout(12000)});
  if(r.status>=300&&r.status<400){const next=new URL(r.headers.get('Location')||'',endpoint);if(next.protocol!=='https:'||next.hostname!==expected.hostname||next.username||next.password||next.port)throw Error('來源轉址無法確認，請直接貼上刊物網址');endpoint=next.href;continue;}
  if(!r.ok)throw Error('Substack HTTP '+r.status);const text=await r.text();if(text.length>2000000)throw Error('作者頁回應過大');return text;
 }throw Error('來源轉址次數過多');
}
export async function resolveSubstackAuthor(value,fetcher=globalThis.fetch){
 const input=substackAuthorInput(value);
 if(input.url==='https://substack.com/@unclestocknotes'||input.url===DEFAULT_SUBSTACK.url)return {candidates:[{url:DEFAULT_SUBSTACK.url,title:DEFAULT_SUBSTACK.title}]};
 if(input.kind==='publication'){
  let title=new URL(input.url).hostname.split('.')[0],warning='';
  try{const xml=await readSubstackSource(input.url+'/feed',fetcher);const name=decode(xml.match(/<channel\b[^>]*>[\s\S]*?<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1]);if(!name)throw Error('未取得有效 RSS');title=name.slice(0,500);}catch{warning='暫時無法讀取刊物名稱，仍可匯入；背景工作將確認來源並顯示結果。';}
  return {candidates:[{url:input.url,title}],...(warning?{warning}:{})};
 }
 const html=await readSubstackSource(input.url,fetcher),candidates=substackProfileCandidates(html);
 if(!candidates.length)throw Error('作者頁尚未提供可辨識的刊物連結，請開啟該作者的刊物頁，貼上 https://刊物.substack.com 網址');
 return {candidates,warning:'請核對作者與刊物。作者頁可能列出多個刊物，只有你選擇的刊物會加入匯入。'};
}
export function normalizeSubstackArticle(data,author){
 const u=new URL(data.url);
 if(u.origin!==author.url||!/^\/p\/[^/]+$/.test(u.pathname)||u.username||u.password)throw Error('文章必須來自對應刊物');
 if(!data.title||String(data.title).length>1000||!Number.isFinite(Date.parse(data.published_at)))throw Error('文章格式錯誤');
 const text=String(data.text||'');if(text.length>100000)throw Error('文章內文超過上限');
 return {id:author.id+':'+u.pathname.slice(3),author_id:author.id,author_title:author.title,url:u.origin+u.pathname,title:String(data.title),published_at:new Date(data.published_at).toISOString(),date:marketDay(new Date(data.published_at),'US'),access:data.access==='public'?'public':'preview',text,mentions:substackMentions(text)};
}
export async function substackRoute(req,{sql,reply,user,admin=false,dispatch,env,flags={},fetcher=globalThis.fetch}){
 const u=new URL(req.url),path=u.pathname;
 if(!['/substack/authors','/substack/articles','/substack/article','/substack/refresh','/substack/resolve','/admin/substack/authors','/admin/substack/update','/admin/substack/continue'].includes(path))return null;
 if(!admin&&!user)return reply({error:'請先登入'},401);
 if(path.startsWith('/admin/')&&!admin)return reply({error:'Forbidden'},403);
 if(!admin&&(flags['markets.us']===false||flags['news_calendar.substack']===false))return reply({error:'Substack 功能目前未開放'},403);
 if(path==='/substack/resolve'){
  if(flags['news_calendar.substack_import']===false)return reply({error:'作者匯入目前未開放'},403);
  if(req.method!=='POST')return reply({error:'Method not allowed'},405);
  try{return reply(await resolveSubstackAuthor((await req.json()).url,fetcher));}catch(e){return reply({error:e.message},400);}
 }
 await sql('CREATE TABLE IF NOT EXISTS substack_authors(id TEXT PRIMARY KEY,url TEXT UNIQUE NOT NULL,title TEXT NOT NULL,archive_offset INTEGER NOT NULL DEFAULT 0,archive_complete INTEGER NOT NULL DEFAULT 0,updated_at TEXT,last_error TEXT)').run();
 await sql('CREATE TABLE IF NOT EXISTS substack_articles(id TEXT PRIMARY KEY,author_id TEXT NOT NULL,date TEXT NOT NULL,published_at TEXT NOT NULL,payload TEXT NOT NULL)').run();
 await sql('CREATE INDEX IF NOT EXISTS substack_articles_date ON substack_articles(date DESC,published_at DESC,id)').run();
 await sql('CREATE INDEX IF NOT EXISTS substack_articles_author ON substack_articles(author_id,published_at)').run();
 await sql('INSERT INTO substack_authors(id,url,title) VALUES(?,?,?) ON CONFLICT(id) DO NOTHING',DEFAULT_SUBSTACK.id,DEFAULT_SUBSTACK.url,DEFAULT_SUBSTACK.title).run();
 if(path.endsWith('/authors')&&req.method==='GET')return reply({authors:(await sql("SELECT a.*,COUNT(b.id) AS article_count,COALESCE(SUM(CASE WHEN json_extract(b.payload,'$.access')='public' THEN 1 ELSE 0 END),0) AS public_count,MAX(b.published_at) AS latest_published_at FROM substack_authors a LEFT JOIN substack_articles b ON b.author_id=a.id GROUP BY a.id ORDER BY a.title").all()).results});
 if(path==='/admin/substack/continue'&&req.method==='POST'){
  const pending=await sql('SELECT id FROM substack_authors WHERE archive_complete=0 AND last_error IS NULL LIMIT 1').first();if(!pending)return reply({continued:false});
  try{await dispatch(env,'substack.yml',{author_id:'',continuation:'true'});return reply({continued:true});}catch(e){await sql('UPDATE substack_authors SET last_error=? WHERE archive_complete=0 AND last_error IS NULL','後續匯入未啟動：'+e.message).run();return reply({error:'後續匯入無法排入：'+e.message},502);}
 }
 if(path==='/substack/authors'&&req.method==='POST'){
  if(flags['news_calendar.substack_import']===false)return reply({error:'作者匯入目前未開放'},403);
  try{const data=await req.json(),input=substackAuthorInput(data.url);let url,title=data.title;
   if(input.kind==='profile'){const resolved=await resolveSubstackAuthor(input.url,fetcher);if(resolved.candidates.length!==1)throw Error('此作者頁列出多個刊物，請先解析作者，再選擇要匯入的刊物');url=resolved.candidates[0].url;title=title||resolved.candidates[0].title;}else url=input.url;
   const id=new URL(url).hostname.split('.')[0];const count=await sql('SELECT COUNT(*) AS total FROM substack_authors').first();if(count.total>=50&&!await sql('SELECT id FROM substack_authors WHERE id=?',id).first())throw Error('作者已達 50 位上限');
   await sql('INSERT INTO substack_authors(id,url,title) VALUES(?,?,?) ON CONFLICT(id) DO NOTHING',id,url,String(title||id).slice(0,500)).run();
   await sql('UPDATE substack_authors SET last_error=NULL WHERE id=?',id).run();
   let warning='';try{await dispatch(env,'substack.yml',{author_id:id,continuation:'false'});}catch(e){warning=e.message;await sql('UPDATE substack_authors SET last_error=? WHERE id=?','背景匯入未啟動：'+warning,id).run();}return reply({ok:true,author:{id,url,title:String(title||id).slice(0,500)},warning,message:warning?'作者已保存，排程尚未啟動':'已開始匯入此刊物的全部歷史文章，背景會自動續抓至最後一頁'});
  }catch(e){return reply({error:e.message},400);}
 }
 if(path==='/substack/refresh'&&req.method==='POST'){
  const data=await req.json(),id=String(data.author_id||'');const row=id?await sql('SELECT * FROM substack_authors WHERE id=?',id).first():null;if(id&&!row)return reply({error:'找不到作者'},404);
  if(row?.archive_complete&&!row.last_error&&row.updated_at&&Date.now()-Date.parse(row.updated_at)<15*60000)return reply({message:'此作者最近 15 分鐘已更新，請先重新載入文章'});
  try{await dispatch(env,'substack.yml',{author_id:id,continuation:'false'});if(row)await sql('UPDATE substack_authors SET last_error=NULL WHERE id=?',id).run();return reply({message:'已排入背景匯入／更新；歷史文章未完成時會自動續抓，你可以關閉頁面'});}catch(e){return reply({error:e.message},502);}
 }
 if(path==='/substack/articles'&&req.method==='GET'){
  const offset=Number(u.searchParams.get('offset')||0);if(!Number.isSafeInteger(offset)||offset<0)return reply({error:'Invalid offset'},400);
  const rows=(await sql('SELECT payload FROM substack_articles ORDER BY published_at DESC,id LIMIT 100 OFFSET ?',offset).all()).results;
  return reply({articles:rows.map(r=>{const {text,...row}=JSON.parse(r.payload);return {...row,mentions:row.mentions.map(({code,name,status})=>({code,name,status}))};}),has_more:rows.length===100,next_offset:offset+rows.length});
 }
 if(path==='/substack/article'&&req.method==='GET'){const row=await sql('SELECT payload FROM substack_articles WHERE id=?',u.searchParams.get('id')).first();return row?reply({article:JSON.parse(row.payload)}):reply({error:'找不到文章'},404);}
 if(path==='/admin/substack/update'&&req.method==='POST'){
  try{const raw=await req.text();if(new TextEncoder().encode(raw).length>1500000)throw Error('批次內容過大');const data=JSON.parse(raw),author=await sql('SELECT * FROM substack_authors WHERE id=?',data.author_id).first();if(!author)throw Error('找不到作者');
   if(data.error){await sql('UPDATE substack_authors SET last_error=? WHERE id=?',String(data.error).slice(0,500),author.id).run();return reply({ok:true});}
   if(!Array.isArray(data.articles)||data.articles.length>20)throw Error('批次格式錯誤');
   const articles=data.articles.map(a=>normalizeSubstackArticle(a,author));for(const a of articles)await sql('INSERT INTO substack_articles(id,author_id,date,published_at,payload) VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload,date=excluded.date,published_at=excluded.published_at',a.id,a.author_id,a.date,a.published_at,JSON.stringify(a)).run();
   const offset=data.archive_offset??author.archive_offset;if(!Number.isSafeInteger(offset)||offset<0)throw Error('Invalid archive cursor');
   await sql('UPDATE substack_authors SET archive_offset=?,archive_complete=?,updated_at=?,last_error=NULL WHERE id=?',offset,data.archive_complete===undefined?author.archive_complete:Number(!!data.archive_complete),new Date().toISOString(),author.id).run();return reply({ok:true,count:articles.length});
  }catch(e){return reply({error:e.message},400);}
 }
 return reply({error:'Method not allowed'},405);
}
