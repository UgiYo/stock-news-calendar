import test from 'node:test';
import assert from 'node:assert/strict';
import worker,{parsePreview} from '../worker/index.js';
const company={code:'2330',name:'台積電',full_name:'台灣積體電路'};
const item=(title,url,date)=>`<item><title>${title}</title><link>${url}</link><pubDate>${date}</pubDate><source url="https://www.cna.com.tw">中央社</source></item>`;
test('preview filters dates, unrelated stories, unsafe links and duplicate URLs',()=>{
 const valid=item('台積電 &amp; 新聞','https://example.com/1','2026-10-01T20:00:00Z');
 const xml='<rss><channel>'+valid+valid+item('12330 其他公司','https://example.com/2','2026-10-01T01:00:00Z')+item('台積電舊聞','https://example.com/3','2026-08-01')+item('台積電','javascript:bad','2026-10-01')+'</channel></rss>';
 const rows=parsePreview(xml,company,new Date('2026-10-02T00:00:00Z'));assert.equal(rows.length,1);assert.equal(rows[0].title,'台積電 & 新聞');assert.equal(rows[0].news_date,'2026-10-02');assert.equal(rows[0].preview,true);assert.equal(rows[0].id,undefined);
});
test('preview reads catalog and session without writing news, jobs or watchlists',async()=>{
 const queries=[];const original=globalThis.fetch;globalThis.fetch=async()=>new Response('<rss><channel>'+item('台積電新聞','https://example.com/story',new Date(Date.now()-3600000).toISOString())+'</channel></rss>');
 const env={APP_URL:'https://example.com',DB:{prepare:q=>{queries.push(q);return {bind:()=>({first:async()=>q.includes('sessions')?{id:'user'}:company,all:async()=>({results:[]})})};}}};
 try{const r=await worker.fetch(new Request('https://worker.example/preview?code=2330',{headers:{Authorization:'Bearer session'}}),env);assert.equal(r.status,200);assert.equal((await r.json()).news.length,1);assert.ok(queries.every(q=>q.startsWith('SELECT')));assert.equal(queries.length,3);}finally{globalThis.fetch=original;}
});
