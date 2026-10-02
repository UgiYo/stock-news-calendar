export function dateKey(date: Date): string {
 return new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'}).format(date);
}
export function previousMonth(date: Date): Date {
 const result=new Date(date); const day=result.getUTCDate(); result.setUTCDate(1); result.setUTCMonth(result.getUTCMonth()-1); result.setUTCDate(Math.min(day,new Date(Date.UTC(result.getUTCFullYear(),result.getUTCMonth()+1,0)).getUTCDate())); return result;
}
export function relevant(title:string,c:{code:string,name:string,full_name:string}):boolean {
 return [c.name,c.full_name].filter(x=>x.length>=2).some(x=>title.includes(x)) || new RegExp(`(^|[^0-9])${c.code}([^0-9]|$)`).test(title);
}
export function parseItem(item:any,c:any,from:Date,to:Date){
 const title=String(item.title??'').trim(),url=String(item.link??''),d=new Date(String(item.pubDate??''));
 if(!title||!/^https?:\/\//.test(url)||!Number.isFinite(d.getTime())||d<from||d>to||!relevant(title,c))return null;
 return {company_code:c.code,title,url,source:String(item.source?.['#text']??item.source??'Google News'),published_at:d.toISOString(),news_date:dateKey(d)};
}
