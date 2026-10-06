let owner='guest';
const initializing=new Map();
const prefix=who=>'stock-account-sync:'+encodeURIComponent(who)+':';
export function setSyncOwner(who){owner=String(who||'guest');}
export function syncOwner(){return owner;}
export function syncEnabled(who=owner){try{return who!=='guest'&&localStorage.getItem(prefix(who)+'enabled')==='true';}catch{return false;}}
export function setSyncEnabled(enabled,who=owner){localStorage.setItem(prefix(who)+'enabled',String(!!enabled));}
export function deviceData(who=owner){try{return JSON.parse(localStorage.getItem(prefix(who)+'data'))||null;}catch{return null;}}
export function saveDeviceData(data,who=owner){localStorage.setItem(prefix(who)+'data',JSON.stringify(data));}
export async function deviceRequest(path,options,remote){
 const who=owner;if(who==='guest'||syncEnabled(who))return undefined;
 const url=new URL(path,'https://device.invalid'),method=options.method||(options.body?'POST':'GET');
 if(!['/watchlists','/news','/prices','/collect'].includes(url.pathname))return undefined;
 let data=deviceData(who);
 if(!data){
  if(!initializing.has(who))initializing.set(who,(async()=>{const result=await remote('/watchlists');const today=new Date(Date.now()+8*3600000).toISOString().slice(0,10),from=today.slice(0,7)+'-01';const news=[];let offset=0;while(true){const batch=await remote(`/news?from=${from}&to=${today}&offset=${offset}`);news.push(...batch.news);if(batch.news.length<500)break;offset+=500;}const snapshot={companies:result.companies,news};saveDeviceData(snapshot,who);return snapshot;})().finally(()=>initializing.delete(who)));
  data=await initializing.get(who);
 }
 if(url.pathname==='/watchlists'){
  if(method==='POST'){const code=options.body.code;if(!data.companies.some(c=>c.code===code)){const result=await remote('/companies?q='+encodeURIComponent(code));const c=result.companies.find(c=>c.code===code);if(!c)throw Error('公司不存在');data.companies.push(c);}}
  if(method==='DELETE'){data.companies=data.companies.filter(c=>c.code!==url.searchParams.get('code'));}
  if(method!=='GET')saveDeviceData(data,who);
  return method==='GET'?{companies:data.companies}:{ok:true};
 }
 if(url.pathname==='/prices'){try{return await remote(path);}catch{return remote('/chart-prices?code='+encodeURIComponent(url.searchParams.get('code')));}}
 if(url.pathname==='/collect'){
  const result=await remote('/preview?code='+encodeURIComponent(options.body.code));
  const fresh=deviceData(who)||data,rows=new Map(fresh.news.map(n=>[n.url,n]));for(const n of result.news)rows.set(n.url,n);
  fresh.news=[...rows.values()];saveDeviceData(fresh,who);return {news:{device:true}};
 }
 const from=url.searchParams.get('from'),to=url.searchParams.get('to'),offset=Number(url.searchParams.get('offset')||0);
 return {news:data.news.filter(n=>data.companies.some(c=>c.code===n.company_code)&&n.news_date>=from&&n.news_date<=to).sort((a,b)=>String(b.published_at).localeCompare(String(a.published_at))).slice(offset,offset+500)};
}
// Only completed public-mode output is shared. Request/config/token data never leaves the device.
export function syncResultPayload(row){
 if(!row||row.local_only||row.local_id||row.cloud_id||row.state!=='complete')return null;
 return {id:row.id,title:row.title,kind:row.kind,date:row.date||'',updated_at:row.updated_at,answer:String(row.answer||''),text:String(row.text||''),transcription_model:String(row.transcription_model||''),partial:!!row.partial,failures:(row.failures||[]).map(String)};
}
