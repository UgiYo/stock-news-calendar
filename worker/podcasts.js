const fields=['id','title','published_at','date','url','audio_url','description','duration','transcript_url'];
export function podcastFeed(value){
 const u=new URL(String(value||'').trim());const h=u.hostname.toLowerCase();
 if(u.protocol!=='https:'||u.username||u.password||u.search||u.hash||u.port||!h.includes('.')||/^[\d.]+$/.test(h)||h.includes(':')||/(^|\.)(localhost|local|internal|test|invalid)$/.test(h))throw Error('請使用公開 HTTPS Podcast RSS 網址');
 return u.href;
}
function payload(data,id,feed){
 if(!data||typeof data.title!=='string'||!data.title.trim()||data.title.length>500||!Array.isArray(data.episodes)||!data.episodes.length||data.episodes.length>150)throw Error('Podcast 集數資料格式錯誤');
 const episodes=data.episodes.map(e=>{
  if(!e.id||!e.title||!Number.isFinite(Date.parse(e.published_at)))throw Error('Podcast 集數資料格式錯誤');
  const row=Object.fromEntries(fields.map(k=>[k,String(e[k]||'').slice(0,k==='description'?10000:2000)]));
  for(const k of ['url','audio_url','transcript_url'])if(row[k]){const u=new URL(row[k]);if(u.protocol!=='https:'||u.username||u.password)throw Error('Podcast 連結必須是 HTTPS');}
  return row;
 });
 const result={id,feed,title:data.title.trim(),spotify:'',updated_at:new Date().toISOString(),episodes};
 if(new TextEncoder().encode(JSON.stringify(result)).length>1500000)throw Error('Podcast 資料超出大小上限');
 return result;
}
export async function resolveSpotifyPodcast(value,fetcher=globalThis.fetch){
 const u=new URL(String(value||''));
 if(u.protocol!=='https:'||u.hostname!=='open.spotify.com'||u.username||u.password||u.port||!/^\/(?:intl-[a-z]+\/)?show\/[A-Za-z0-9]{22}\/?$/.test(u.pathname))throw Error('請貼上 Spotify 節目連結（show），不是單集連結。');
 const show=u.pathname.split('/').filter(Boolean).at(-1),url='https://open.spotify.com/show/'+show;
 const read=async endpoint=>{const r=await fetcher(endpoint,{redirect:'error',signal:AbortSignal.timeout(10000),headers:{Accept:'application/json'}});if(!r.ok)throw Error('搜尋服務暫時無法使用，請稍後重試。');return r.json();};
 const page=await fetcher(url,{redirect:'error',signal:AbortSignal.timeout(10000),headers:{Accept:'text/html','User-Agent':'Mozilla/5.0'}});
 if(!page.ok)throw Error('Spotify 節目頁暫時無法讀取，請稍後重試。');
 const html=await page.text();
 const decode=v=>v.replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&#(\d+);/g,(_,n)=>String.fromCodePoint(Number(n)));
 const title=decode(html.match(/<meta\s+property=["']og:title["']\s+content=["']([^"']+)["']/i)?.[1]||'').trim();if(!title||title.length>500)throw Error('無法取得 Spotify 節目名稱。');
 const results=await read('https://itunes.apple.com/search?media=podcast&entity=podcast&country=TW&limit=25&term='+encodeURIComponent(title));
 const normalize=v=>String(v||'').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
 const target=normalize(title),seen=new Set(),candidates=[];
 for(const row of results.results||[]){const name=String(row.collectionName||row.trackName||''),n=normalize(name);if(!n||!(n===target||n.includes(target)||target.includes(n)))continue;let feed;try{feed=podcastFeed(row.feedUrl);}catch{continue;}if(seen.has(feed))continue;seen.add(feed);candidates.push({title:name,author:String(row.artistName||''),feed});}
 return {title,candidates:candidates.slice(0,10)};
}
export async function sharedPodcastsRoute(req,{sql,reply,user,admin=false,hash}){
 const u=new URL(req.url),path=u.pathname;
 if(!['/podcasts/channels','/podcasts/episodes','/admin/podcasts/channels','/admin/podcasts/update','/podcasts/resolve'].includes(path))return null;
 if(!admin&&!user)return reply({error:'請先登入'},401);
 if(path==='/podcasts/resolve'){if(req.method!=='POST')return reply({error:'Method not allowed'},405);try{return reply(await resolveSpotifyPodcast((await req.json()).url));}catch(e){return reply({error:e.message},400);}}
 await sql('CREATE TABLE IF NOT EXISTS podcast_channels(id TEXT PRIMARY KEY,feed TEXT NOT NULL UNIQUE,title TEXT NOT NULL,payload TEXT NOT NULL,created_by TEXT NOT NULL,updated_at TEXT NOT NULL,last_error TEXT)').run();
 if((path==='/podcasts/channels'||path==='/admin/podcasts/channels')&&req.method==='GET')return reply({channels:(await sql('SELECT id,feed,title,updated_at,last_error FROM podcast_channels ORDER BY title LIMIT 100').all()).results});
 if(path==='/podcasts/episodes'&&req.method==='GET'){
  const row=await sql('SELECT payload,last_error FROM podcast_channels WHERE id=?',u.searchParams.get('id')).first();return row?reply({...JSON.parse(row.payload),error:row.last_error||''}):reply({error:'找不到頻道'},404);
 }
 if(path==='/podcasts/episodes'&&req.method==='POST'){
  const row=await sql('SELECT id,feed FROM podcast_channels WHERE id=?',u.searchParams.get('id')).first();if(!row)return reply({error:'找不到頻道'},404);
  try{const data=await req.json();if(podcastFeed(data.feed)!==row.feed)throw Error('Feed mismatch');const saved=payload(data,row.id,row.feed);await sql('UPDATE podcast_channels SET title=?,payload=?,updated_at=?,last_error=NULL WHERE id=?',saved.title,JSON.stringify(saved),saved.updated_at,row.id).run();return reply(saved);}catch{return reply({error:'Podcast 更新資料格式錯誤'},400);}
 }
 if(path==='/podcasts/channels'&&req.method==='POST'){
  try{
   const data=await req.json(),feed=podcastFeed(data.feed),id='shared-'+(await hash(feed)).slice(0,24),existing=await sql('SELECT payload FROM podcast_channels WHERE feed=?',feed).first();
   if(existing)return reply({channel:JSON.parse(existing.payload),existing:true});
   const count=await sql('SELECT COUNT(*) AS total FROM podcast_channels').first();if(count.total>=100)return reply({error:'共用頻道已達 100 個上限'},409);
   const saved=payload(data,id,feed);
   await sql('INSERT INTO podcast_channels(id,feed,title,payload,created_by,updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT(feed) DO NOTHING',id,feed,saved.title,JSON.stringify(saved),user.id,saved.updated_at).run();
   const row=await sql('SELECT payload FROM podcast_channels WHERE feed=?',feed).first();return reply({channel:JSON.parse(row.payload)});
  }catch{return reply({error:'匯入失敗：請確認公開 HTTPS RSS 與集數內容'},400);}
 }
 if(path==='/admin/podcasts/update'&&req.method==='POST'){
  const data=await req.json(),row=await sql('SELECT * FROM podcast_channels WHERE id=?',data.id).first();if(!row)return reply({error:'找不到頻道'},404);
  if(data.error){await sql('UPDATE podcast_channels SET last_error=? WHERE id=?',String(data.error).slice(0,500),row.id).run();return reply({ok:true});}
  try{const saved=payload(data,row.id,row.feed);await sql('UPDATE podcast_channels SET title=?,payload=?,updated_at=?,last_error=NULL WHERE id=?',saved.title,JSON.stringify(saved),saved.updated_at,row.id).run();return reply({ok:true});}catch{return reply({error:'Podcast 集數資料格式錯誤'},400);}
 }
 return reply({error:'Method not allowed'},405);
}
