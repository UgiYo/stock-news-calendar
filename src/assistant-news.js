// Read the existing archive, independently of the calendar's selected month.
export async function loadAssistantNews({request,news=[],signal,assertOwner=()=>{}}){
 const rows=new Map();
 const append=batch=>{for(const n of batch)rows.set(n.company_code+':'+(n.url||n.id),n);};
 let offset=0;
 while(true){
  signal?.throwIfAborted();assertOwner();
  const batch=await request('/news?from=0001-01-01&to=9999-12-31&offset='+offset,{signal});
  assertOwner();signal?.throwIfAborted();
  if(!Array.isArray(batch.news))throw Error('既有新聞資料格式有誤，請稍後再試。');
  append(batch.news);
  if(batch.news.length<500)break;
  offset+=500;
 }
 append(news);
 return [...rows.values()];
}
