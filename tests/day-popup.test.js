import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const source=readFileSync(new URL('../src/main.js',import.meta.url),'utf8');
const fn=source.slice(source.indexOf('function dayWindow('),source.indexOf('\nconst esc='));

function renderDay({tab='news',rows=[{company_code:'2330',title:'台積電新聞',published_at:'2026-10-07T03:00:00Z',url:'https://example.com'}]}={}){
 const state={date:'2026-10-07',selected:'',dayTab:tab,companies:[{code:'2330',name:'台積電'},{code:'2317',name:'鴻海'}]};
 const ctx=vm.createContext({state,movementCache:new Map([['ctx',{movements:[
  {code:'2330',triggered:true,date:'2026-10-07'},
  {code:'2317',triggered:true,date:'2026-10-07'},
  {code:'2327',triggered:true,date:'2026-10-07'},
  {code:'2330',triggered:true,date:'2026-10-06'}
 ]}]]),movementContext:()=>({key:'ctx'}),movementSummary:()=>'+8%',esc:String,summarize:()=> '當日摘要',safeURL:x=>x,podcastMentionPanel:()=>'<aside>提及追蹤股</aside>',mentionedPodcastCard:p=>`<article>${p.title}</article>`});
 vm.runInContext(fn,ctx);
 return ctx.dayWindow(rows,[{title:'Podcast 節目'}]);
}

test('date popup separates News and Podcast into independently selected tabs',()=>{
 const news=renderDay();
 assert.match(news,/role="tablist"/);
 assert.match(news,/aria-selected="true" aria-controls="day-panel-news"/);
 assert.match(news,/id="day-panel-podcast" role="tabpanel"[^>]*hidden/);
 const podcast=renderDay({tab:'podcast'});
 assert.match(podcast,/aria-selected="true" aria-controls="day-panel-podcast"/);
 assert.match(podcast,/id="day-panel-news" role="tabpanel"[^>]*hidden/);
 assert.match(podcast,/提及追蹤股/);
 assert.match(podcast,/Podcast 節目/);
});

test('day movement details start collapsed and include only stocks with same-day news',()=>{
 const html=renderDay();
 assert.match(html,/<details class="day-movements"><summary>⚡ 當日個股異動（1）/);
 assert.match(html,/2330 · \+8%/);
 assert.doesNotMatch(html,/2317 · \+8%|2327 · \+8%/);
});
