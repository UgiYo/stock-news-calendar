import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {rankingNewsPanel} from '../src/stock-ranking.js';
const source=readFileSync(new URL('../src/main.js',import.meta.url),'utf8');
function setup(api){const c=vm.createContext({rankingDetail:{code:'3037'},state:{user:{id:'u'},news:[]},render(){},curateNews:r=>r,api});vm.runInContext(source.slice(source.indexOf('async function toggleRankingNews'),source.indexOf('async function changeCandlePeriod')),c);return c;}
test('preview stays in stock dialog, sorts news and reopens without another request',async()=>{
 let calls=0;const c=setup(async()=>{calls++;return {news:[{news_date:'2026-10-01'},{news_date:'2026-10-05'}]};});await c.toggleRankingNews();assert.equal(c.rankingDetail.newsOpen,true);assert.equal(c.rankingDetail.recentNews[0].news_date,'2026-10-05');await c.toggleRankingNews();assert.equal(c.rankingDetail.newsOpen,false);await c.toggleRankingNews();assert.equal(calls,1);
});
test('news failure remains visible with saved fallback and allows retry',async()=>{
 let fail=true;const c=setup(async()=>{if(fail)throw Error('來源失敗');return {news:[]};});c.state.news=[{company_code:'3037',title:'已保存'},{company_code:'2330',title:'其他'}];await c.toggleRankingNews();assert.equal(c.rankingDetail.newsError,'來源失敗');assert.equal(c.rankingDetail.recentNews.length,1);fail=false;await c.toggleRankingNews(true);assert.equal(c.rankingDetail.newsError,'');assert.equal(c.rankingDetail.newsLoading,false);
});
test('late news response cannot overwrite another stock dialog',async()=>{
 let resolve;const c=setup(()=>new Promise(r=>resolve=r));const pending=c.toggleRankingNews();c.rankingDetail={code:'2330'};resolve({news:[{title:'舊個股'}]});await pending;assert.equal(c.rankingDetail.recentNews,undefined);
});
test('news panel distinguishes loading failure and empty results and sanitizes links',()=>{
 const esc=s=>String(s??'').replaceAll('<','&lt;');assert.equal(rankingNewsPanel({},esc),'');assert.match(rankingNewsPanel({newsOpen:true,newsLoading:true},esc),/正在讀取新聞/);assert.match(rankingNewsPanel({newsOpen:true,newsError:'來源失敗'},esc),/重試讀取新聞/);assert.match(rankingNewsPanel({newsOpen:true},esc),/沒有回傳/);const html=rankingNewsPanel({newsOpen:true,recentNews:[{title:'<script>',url:'javascript:alert(1)'}]},esc);assert.match(html,/href="#"/);assert.doesNotMatch(html,/<script>/);
});
