import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {parseHTML} from 'linkedom';
import {DEFAULT_SUBSTACK,substackPublication,substackAuthorInput,substackMentions,substackChunks,substackPrompt} from '../shared/substack.js';
import {normalizeSubstackArticle,substackRoute,resolveSubstackAuthor,substackProfileCandidates} from '../worker/substack.js';
import {validAccountResult} from '../worker/account-results.js';
import {decorateSubstackSummary} from '../src/substack-mentions.js';

test('verified profile resolves publication, while untrusted destinations are rejected',()=>{
 assert.equal(substackPublication('https://substack.com/@unclestocknotes?utm_source=share'),DEFAULT_SUBSTACK.url);
 assert.equal(substackPublication(DEFAULT_SUBSTACK.url+'/p/post?utm_source=share'),DEFAULT_SUBSTACK.url);
 for(const url of ['http://x.substack.com','https://substack.com/@unknown','https://x.substack.com.evil.test','https://user:secret@x.substack.com','https://127.0.0.1'])assert.throws(()=>substackPublication(url));
});
test('arbitrary author profiles resolve observed publication links without assuming the handle is the publication',async()=>{
 const html='<a href="https://actualletters.substack.com/">作者的投資筆記</a><a href="https://secondletters.substack.com/about">另一本刊物</a><a href="https://evil.test">惡意連結</a><a href="https://actualletters.substack.com/p/post">文章</a>';
 const calls=[];const result=await resolveSubstackAuthor('https://substack.com/@differenthandle?utm_source=share',async url=>{calls.push(url);return new Response(html);});
 assert.deepEqual(result.candidates.map(c=>c.url),['https://actualletters.substack.com','https://secondletters.substack.com']);assert.match(result.warning,/核對/);assert.deepEqual(calls,['https://substack.com/@differenthandle']);
 assert.deepEqual(substackAuthorInput('https://open.substack.com/pub/actualletters/p/a?utm_source=share'),{kind:'publication',url:'https://actualletters.substack.com'});
 assert.equal(substackAuthorInput('https://www.substack.com/%40differenthandle/posts').url,'https://substack.com/@differenthandle');
 assert.equal(substackProfileCandidates('<a href="https://x.substack.com.evil.test">x</a>').length,0);
 await assert.rejects(()=>resolveSubstackAuthor('https://substack.com/@empty',async()=>new Response('<html></html>')),/刊物頁/);
 await assert.rejects(()=>resolveSubstackAuthor('https://substack.com/@redirect',async()=>new Response('',{status:302,headers:{Location:'https://127.0.0.1'}})),/转址|轉址/);
});
test('publication links get their RSS name, while unreachable metadata still permits explicit import',async()=>{
 const data=await resolveSubstackAuthor('https://letters.substack.com/p/post',async()=>new Response('<rss><channel><title><![CDATA[Letters &amp; Stocks]]></title></channel></rss>'));
 assert.equal(data.candidates[0].title,'Letters & Stocks');assert.equal(data.candidates[0].url,'https://letters.substack.com');
 const fallback=await resolveSubstackAuthor('https://letters.substack.com',async()=>new Response('',{status:503}));assert.equal(fallback.candidates[0].url,'https://letters.substack.com');assert.ok(fallback.warning);
});
test('original paragraphs match US aliases, exclude Taiwan and ambiguous tickers, and distinguish mention from stance',()=>{
 const text='AI improves productivity. We are ON track.\nNVIDIA 與 $MSFT 被提及，但作者沒有表示持有。\n$ZZZZ is only a hypothetical symbol.\n'+'背景 '.repeat(400)+'$NVDA 看法放在長段落最後。';
 const rows=substackMentions(text);
 assert.ok(rows.some(c=>c.code==='US:NVDA'));assert.ok(rows.some(c=>c.code==='US:MSFT'));assert.ok(!rows.some(c=>['US:ON','US:AI','US:ARE'].includes(c.code)));
 assert.match(rows.find(c=>c.code==='US:ZZZZ').status,/待確認/);assert.match(rows.find(c=>c.code==='US:NVDA').evidence.at(-1).text,/NVDA/);
 assert.equal(substackMentions('台積電 2330',[{code:'2330',name:'台積電'}]).length,0);
 assert.ok(rows.every(c=>!c.status.includes('看多')));
});
test('article provenance and US date are checked and paywall classification is conservative',()=>{
 const a=normalizeSubstackArticle({url:DEFAULT_SUBSTACK.url+'/p/abc?utm_source=share',title:'NVDA',published_at:'2026-10-14T01:00:00Z',access:'paid',text:'Only a subtitle'},DEFAULT_SUBSTACK);
 assert.equal(a.date,'2026-10-13');assert.equal(a.access,'preview');assert.equal(a.url,DEFAULT_SUBSTACK.url+'/p/abc');assert.equal(a.mentions.length,0); // title alone is not original-body evidence
 assert.throws(()=>normalizeSubstackArticle({...a,url:'https://evil.test/p/abc'},DEFAULT_SUBSTACK));
 assert.throws(()=>normalizeSubstackArticle({...a,published_at:'bad'},DEFAULT_SUBSTACK));
});
test('long articles are split without losing text or global paragraph numbers',()=>{
 const text='第一段 NVIDIA\n'+('長段落 '.repeat(9000))+'\n第三段 $MSFT';const chunks=substackChunks(text);
 assert.ok(chunks.length>2);assert.ok(chunks.every(c=>c.text.length<=16001));
 assert.equal(chunks.map(c=>c.text.replace(/\s/g,'')).join(''),text.replace(/\s/g,''));
 assert.match(chunks.at(-1).numbered_text,/段落 3/);const prompt=substackPrompt({title:'文',author_title:'作者',date:'2026-10-13',url:DEFAULT_SUBSTACK.url+'/p/abc',access:'preview',...chunks.at(-1)});
 assert.match(prompt,/立場不明/);assert.match(prompt,/不能把提及當成推薦或持有/);assert.match(prompt,/段落 3/);assert.match(prompt,/公開預覽/);
});
test('shared archive upserts, exposes metadata separately, preserves failure state and enforces admin feature controls',async()=>{
 const db=new DatabaseSync(':memory:');const sql=(q,...args)=>({first:async()=>db.prepare(q).get(...args)||null,all:async()=>({results:db.prepare(q).all(...args)}),run:async()=>db.prepare(q).run(...args)});
 const call=async(path,method='GET',body,extra={})=>substackRoute(new Request('https://api.test'+path,{method,...(body?{body:JSON.stringify(body)}:{})}),{sql,reply:(data,status=200)=>({data,status}),user:{id:'alice'},dispatch:async()=>true,env:{},...extra});
 assert.equal((await call('/substack/authors','GET',null,{user:null})).status,401);
 const authors=(await call('/substack/authors')).data.authors;assert.equal(authors.length,1);
 const data={author_id:DEFAULT_SUBSTACK.id,articles:[{url:DEFAULT_SUBSTACK.url+'/p/abc',title:'文章',text:'NVIDIA 原文',access:'public',published_at:'2026-10-14T01:00:00Z'}],archive_offset:1,archive_complete:true};
 await call('/admin/substack/update','POST',data,{admin:true});await call('/admin/substack/update','POST',data,{admin:true});
 const listing=(await call('/substack/articles')).data;assert.equal(listing.articles.length,1);assert.equal(listing.articles[0].text,undefined);assert.equal(listing.articles[0].mentions[0].code,'US:NVDA');
 const detail=(await call('/substack/article?id='+encodeURIComponent(listing.articles[0].id))).data.article;assert.equal(detail.text,'NVIDIA 原文');
 assert.equal((await call('/substack/articles','GET',null,{flags:{'news_calendar.substack':false}})).status,403);
 assert.equal((await call('/substack/authors','POST',{url:'https://example.substack.com'},{flags:{'news_calendar.substack_import':false}})).status,403);
 await call('/admin/substack/update','POST',{author_id:DEFAULT_SUBSTACK.id,error:'Source unavailable'},{admin:true});
 const failed=(await call('/substack/authors')).data.authors[0];assert.equal(failed.archive_offset,1);assert.equal(failed.archive_complete,1);assert.match(failed.last_error,/unavailable/);assert.ok(failed.latest_published_at);
 assert.equal(failed.article_count,1);assert.equal(failed.public_count,1);
 assert.equal((await call('/substack/articles?offset=-1')).status,400);db.close();
});
test('user author import dispatches a prioritized full archive and continuation queues only healthy incomplete sources',async()=>{
 const db=new DatabaseSync(':memory:');const sql=(q,...args)=>({first:async()=>db.prepare(q).get(...args)||null,all:async()=>({results:db.prepare(q).all(...args)}),run:async()=>db.prepare(q).run(...args)}),dispatches=[];
 const call=async(path,body,extra={})=>substackRoute(new Request('https://api.test'+path,{method:'POST',body:JSON.stringify(body)}),{sql,reply:(data,status=200)=>({data,status}),user:{id:'alice'},dispatch:async(...args)=>{dispatches.push(args);return true;},env:{},...extra});
 const result=await call('/substack/authors',{url:'https://letters.substack.com',title:'Letters'});assert.equal(result.data.author.id,'letters');assert.match(result.data.message,/全部歷史文章/);assert.deepEqual(dispatches[0][2],{author_id:'letters',continuation:'false'});
 db.prepare('UPDATE substack_authors SET updated_at=? WHERE id=?').run(new Date().toISOString(),'letters');
 const refresh=await call('/substack/refresh',{author_id:'letters'});assert.equal(refresh.status,200);assert.equal(dispatches.length,2); // recent partial import must not be throttled
 await call('/admin/substack/continue',{}, {admin:true});assert.deepEqual(dispatches.at(-1)[2],{author_id:'',continuation:'true'});
 db.prepare("UPDATE substack_authors SET archive_complete=1").run();const before=dispatches.length;assert.equal((await call('/admin/substack/continue',{}, {admin:true})).data.continued,false);assert.equal(dispatches.length,before);
 db.prepare("UPDATE substack_authors SET archive_complete=0,last_error='blocked'").run();assert.equal((await call('/admin/substack/continue',{}, {admin:true})).data.continued,false);
 assert.equal((await call('/substack/resolve',{url:'https://letters.substack.com'},{flags:{'news_calendar.substack_import':false}})).status,403);
 assert.equal((await call('/admin/substack/continue',{})).status,403);db.close();
});
test('Substack results use the same private account schema and source paragraph navigation',()=>{
 const row={id:'substack:a',title:'文章',kind:'substack',date:'2026-10-13',updated_at:'2026-10-14T00:00:00Z',answer:'作者觀點',text:'NVIDIA 是觀察標的。',partial:true,failures:[],episode:{id:'a',url:DEFAULT_SUBSTACK.url+'/p/a',channel_name:'作者'}};
 assert.ok(validAccountResult(row));assert.ok(!validAccountResult({...row,owner:'bob'}));
 const {document}=parseHTML('<html><body><article>作者觀點</article></body></html>');const previous=globalThis.document;globalThis.document=document;
 try{const body=document.querySelector('article');decorateSubstackSummary(body,row,'US:NVDA');assert.ok(body.querySelector('[data-substack-evidence="US:NVDA"]').open);assert.match(body.textContent,/公開預覽/);assert.match(body.textContent,/觀察標的/);}finally{globalThis.document=previous;}
});
