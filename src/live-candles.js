export function marketOpen(now=new Date()){
 const tw=new Date(now.getTime()+8*3600000),day=tw.getUTCDay(),minute=tw.getUTCHours()*60+tw.getUTCMinutes();
 return day>0&&day<6&&minute>=540&&minute<=810;
}
export function mergeLiveBars(history=[],live=[]){
 const rows=new Map(history.map(r=>[r.date,r]));
 for(const row of live)rows.set(row.date,row);
 return [...rows.values()].sort((a,b)=>a.date.localeCompare(b.date));
}
