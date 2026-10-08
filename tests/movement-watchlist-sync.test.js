import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../src/main.js',import.meta.url),'utf8');
function fixture(){
 const state={user:{id:'alice'},companies:[{code:'2330',name:'台積電'},{code:'2327',name:'國巨'}],selected:'',date:'2026-10-07',rankingPage:false};
 const requests=[];
 const ctx=vm.createContext({state,ranking:{stocks:[{code:'2317',name:'鴻海',amount:10}]},rankingDate:'2026-10-07',completedDay:()=> '2026-10-07',esc:String,movementSummary:()=> '3 日 +10%',Date,api:()=>{},render:()=>{},loadMovementOverview:c=>new Promise(resolve=>requests.push({c,resolve}))});
 vm.runInContext(source.slice(source.indexOf('const movementCache=new Map();'),source.indexOf('let marketPrices=')),ctx);
 return {ctx,state,requests};
}
test('movement query and cards contain only tracked stocks when viewing all',async()=>{
 const {ctx,requests}=fixture();
 assert.deepEqual(Array.from(ctx.movementContext().codes),['2327','2330']);
 const pending=ctx.loadMovements();
 assert.deepEqual(Array.from(requests[0].c.codes),['2327','2330']);
 requests[0].resolve({owner_id:'alice',movements:[{code:'2330',triggered:true,date:'2026-10-07'},{code:'2317',triggered:true,date:'2026-10-07'}]});
 await pending;
 assert.match(ctx.movementOverview(),/data-movement="2330"/);
 assert.doesNotMatch(ctx.movementOverview(),/data-movement="2317"/);
 assert.match(ctx.movementOverview(),/全部追蹤公司 2 檔/);
});
test('selected tracked company scopes results; removed or untracked selection is excluded',()=>{
 const {ctx,state}=fixture();
 state.selected='2330';
 assert.deepEqual(Array.from(ctx.movementContext().codes),['2330']);
 assert.match(ctx.movementOverview(),/目前選擇：2330 台積電/);
 state.companies=state.companies.filter(c=>c.code!=='2330');
 assert.deepEqual(Array.from(ctx.movementContext().codes),[]);
 assert.match(ctx.movementOverview(),/尚未加入追蹤清單/);
});
test('calendar appears before filters and the collapsed movement panel',()=>{
 const calendar=source.indexOf('<div class="calendar">');
 const filters=source.indexOf('<section class="podcast-filter" id="podcast-filter">');
 const movement=source.indexOf('${movementOverview()}',filters);
 assert.ok(calendar>=0&&filters>calendar&&movement>filters);
 assert.ok(source.includes('<details class=\"movement-overview-collapsible\">')); 
});
