// Query the complete saved archive, independently of the calendar's visible month.
export async function loadAssistantNews(request,{news=[],signal,onProgress=()=>{},isCurrent=()=>true}={}){
 const rows=new Map(news.map(n=>[n.company_code+':'+n.url,n]));
 let offset=0;
 while(true){
  signal?.throwIfAborted();
  if(!isCurrent())throw Error('登入帳號已變更，請重新提問。');
  const batch=await request('/news?from=0001-01-01&to=9999-12-31&offset='+offset);
  signal?.throwIfAborted();
  if(!isCurrent())throw Error('登入帳號已變更，請重新提問。');
  for(const n of batch.news)rows.set(n.company_code+':'+n.url,n);
  onProgress(rows.size);
  // Synced device rows are merged into the first page, so use the server count.
  const count=batch.serverCount??batch.news.length;
  if(count<500)break;
  offset+=count;
 }
 return [...rows.values()];
}
