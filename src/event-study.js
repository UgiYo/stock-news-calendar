export function eventCategory(title){for(const [name,pattern] of [['營收',/營收/],['財報',/財報|獲利|每股盈餘|EPS/i],['法說',/法說/],['投資與產能',/建廠|擴產|投資|產能/],['訂單與產品',/訂單|新品|新產品/],['併購',/併購|收購/],['法律與政策',/訴訟|裁罰|關稅|政策/]])if(pattern.test(title))return name;return '其他';}
export function studyEvent(news,prices){
 const bars=prices.filter(p=>p.code===news.company_code).sort((a,b)=>a.date.localeCompare(b.date));
 const tw=new Date(Date.parse(news.published_at)+8*3600000);if(!Number.isFinite(tw.getTime()))return null;
 const day=tw.toISOString().slice(0,10),afterClose=tw.getUTCHours()*60+tw.getUTCMinutes()>=810;
 const i=bars.findIndex(p=>afterClose?p.date>day:p.date>=day);
 if(i<1)return null;
 const base=bars[i-1],benchmark=new Map(prices.filter(p=>p.code==='TAIEX').map(p=>[p.date,p.close]));
 return {publishedDay:day,afterClose,date:bars[i].date,baseline:base.date,baselineClose:base.close,alignment:bars[i].date===day?'盤中／開盤前新聞，對齊當日':afterClose?'13:30 起發布，對齊下一交易日':'非交易日發布，對齊下一交易日',category:eventCategory(news.title),before5:i>=6?(base.close/bars[i-6].close-1)*100:null,returns:[1,3,5,20].map(n=>{const end=bars[i+n-1];if(!end)return {days:n};const stock=(end.close/base.close-1)*100,b0=benchmark.get(base.date),b1=benchmark.get(end.date);const market=b0&&b1?(b1/b0-1)*100:null;return {days:n,date:end.date,close:end.close,stock,market,excess:market===null?null:stock-market};})};
}
