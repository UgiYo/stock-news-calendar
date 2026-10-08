export function countPodcastDayEntries(date,episodes=[],mentions=[]){
 const ids=new Set(),titles=new Set();
 const add=(id,title)=>{
  const normalizedId=String(id||'').replace(/^podcast:/,'');
  const normalizedTitle=String(title||'').trim().toLocaleLowerCase();
  if((normalizedId&&ids.has(normalizedId))||(normalizedTitle&&titles.has(date+':'+normalizedTitle)))return false;
  if(normalizedId)ids.add(normalizedId);
  if(normalizedTitle)titles.add(date+':'+normalizedTitle);
  return true;
 };
 let count=0;
 for(const episode of episodes)if(episode?.date===date&&add(episode.id,episode.title))count++;
 for(const item of mentions){
  const record=item?.record||item;
  if((record?.date||record?.episode?.date)!==date)continue;
  if(add(record?.episode?.id||record?.id,record?.title||record?.episode?.title))count++;
 }
 return count;
}
