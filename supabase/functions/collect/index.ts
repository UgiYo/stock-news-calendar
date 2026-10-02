import { XMLParser } from 'npm:fast-xml-parser@5.3.0';
import {dateKey,previousMonth,parseItem} from './logic.ts';
const base=Deno.env.get('SUPABASE_URL')!,service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const allowed=Deno.env.get('APP_ORIGIN')||'';
const headers={'Content-Type':'application/json','Access-Control-Allow-Origin':allowed,'Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info, x-collector-secret','Vary':'Origin'};
const reply=(status:number,data:unknown)=>new Response(JSON.stringify(data),{status,headers});
async function rest(path:string,method='GET',body?:unknown){const r=await fetch(base+'/rest/v1/'+path,{method,headers:{apikey:service,Authorization:`Bearer ${service}`,'Content-Type':'application/json',Prefer:'resolution=merge-duplicates,return=representation'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(20000)});if(!r.ok)throw Error(`資料庫操作失敗 (${r.status})`);return r.status===204?null:await r.json();}
Deno.serve(async(req)=>{
 if(req.method==='OPTIONS')return new Response(null,{headers});
 if(req.method!=='POST')return reply(405,{error:'Method not allowed'});
 try{
 const schedulerSecret=Deno.env.get('COLLECTOR_SECRET');
 const scheduled=!!schedulerSecret&&req.headers.get('x-collector-secret')===schedulerSecret;
 let uid='';
 if(!scheduled){const token=req.headers.get('Authorization');if(!token)return reply(401,{error:'需要登入'});const r=await fetch(base+'/auth/v1/user',{headers:{apikey:Deno.env.get('SUPABASE_ANON_KEY')!,Authorization:token},signal:AbortSignal.timeout(15000)});if(!r.ok)return reply(401,{error:'登入已失效'});uid=(await r.json()).id;}
 const {code}=await req.json();if(code!==undefined&&!/^\d{4,6}$/.test(code))return reply(400,{error:'無效股號'});
 if(!code)return reply(400,{error:'必須指定公司'});
 let tracked=await rest(`watchlists?select=company_code&${scheduled?'':`user_id=eq.${uid}&`}${code?`company_code=eq.${code}`:''}`);
 const codes=[...new Set(tracked.map((w:any)=>w.company_code))] as string[];
 if(!codes.length)return reply(code?403:200,{error:code?'尚未追蹤此公司':undefined,updated:0});
 if(codes.length>10&&!scheduled)return reply(400,{error:'追蹤超過 10 間時，請選單一公司更新；每日排程仍會更新所有公司。'});
 const results:any[]=[],errors:any[]=[];
 for(const stock of codes){
 const claimed=await rest('rpc/claim_collection','POST',{stock_code:stock});if(!claimed){results.push({code:stock,skipped:true});continue;}
 try{
 const c=(await rest(`companies?code=eq.${stock}&select=*`))[0];const now=new Date(),from=previousMonth(now);
 // Split each calendar day to reduce Google News RSS's per-query cap. Each date is publication time, not collection time.
 const windows:Array<[Date,Date]>=[];for(let cursor=new Date(from);cursor<now;){const end=new Date(Math.min(cursor.getTime()+86400000,now.getTime()));windows.push([new Date(cursor),end]);cursor=end;}
 const rows=new Map<string,any>();
 // Four concurrent requests, bounded per company. Always backfill a month to recover missed scheduled runs.
 for(let i=0;i<windows.length;i+=4){await Promise.all(windows.slice(i,i+4).map(async([start,end])=>{
 const before=new Date(end.getTime()+86400000);const after=new Date(start.getTime()-86400000);
 const q=`("${c.name}" OR "${c.full_name}" OR "${c.code}") after:${dateKey(after)} before:${dateKey(before)}`;
 const url='https://news.google.com/rss/search?'+new URLSearchParams({q,hl:'zh-TW',gl:'TW',ceid:'TW:zh-Hant'});
 let response:Response|undefined;for(let retry=0;retry<3;retry++){try{response=await fetch(url,{signal:AbortSignal.timeout(12000)});if(response.ok)break;}catch(e){if(retry===2)throw e;}if(retry<2)await new Promise(r=>setTimeout(r,500*(retry+1)));}
 if(!response?.ok)throw Error('新聞來源暫時無法存取');
 const xml=new XMLParser({ignoreAttributes:false,processEntities:true}).parse(await response.text());if(!xml.rss?.channel)throw Error('來源未回傳有效 RSS');
 const raw=xml.rss.channel.item||[];for(const item of Array.isArray(raw)?raw:[raw]){const row=parseItem(item,c,from,now);if(row)rows.set(row.url,row);}
 }));}
 const all=[...rows.values()];for(let i=0;i<all.length;i+=200)await rest('news?on_conflict=company_code,url','POST',all.slice(i,i+200));
 await rest(`companies?code=eq.${stock}`,'PATCH',{last_collected_at:now.toISOString(),last_error:null,collecting_until:null});results.push({code:stock,count:all.length});
 }catch(e){await rest(`companies?code=eq.${stock}`,'PATCH',{last_error:'新聞更新失敗，請重試',collecting_until:null});errors.push({code:stock,error:'新聞更新失敗'});}
 }
 return reply(200,{results,errors});
 }catch(e){console.error('collector failed',e instanceof Error?e.message:'unknown');return reply(500,{error:'新聞更新失敗，請稍後再試。'});}
});
