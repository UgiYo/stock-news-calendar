import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../src/main.js',import.meta.url),'utf8');
function fixture(){
 const state={user:{id:'alice'},companies:[{code:'2330',name:'台積電'},{code:'2327',name:'國巨'}],selected:'',date:'2026-10-07',rankingPage:false};
 const requests=[],renders=[];
 const ctx=vm.createContext({state,ranking:{stocks:[{code:'2317',name:'鴻海',amount:10}]},rankingDate:'2026-10-07',completedDay:()=> '2026-10-07',esc:String,movementSummary:()=> '3 日 +10%',Date,api:()=>{},render:()=>renders.push(ctx.movementContext().key),loadMovementOverview:c=>new Promise(resolve=>requests.push({c,resolve}))});
 vm.runInContext(source.slice(source.indexOf('const movementCache=new Map();'),source.indexOf('let marketPrices=')),ctx);
 return {ctx,state,requests,renders};
}
test('movement overview follows company selection and labels ranking-only stocks',async()=>{
 const {ctx,state,requests}=fixture();
 assert.deepEqual(Array.from(ctx.movementContext().codes),['2317','2327','2330']);
 state.selected='2330';assert.deepEqual(Array.from(ctx.movementContext().codes),['2330']);const pending=ctx.loadMovements();assert.match(ctx.movementOverview(),/目前選擇：2330 台積電/);assert.match(ctx.movementOverview(),/讀取行情/);
 requests[0].resolve({owner_id:'alice',movements:[{code:'2330',triggered:true,date:state.date},{code:'2317',triggered:true,date:state.date}]});await pending;
 assert.match(ctx.movementOverview(),/data-movement="2330"/);assert.doesNotMatch(ctx.movementOverview(),/data-movement="2317"/);
 state.selected='';const all=ctx.loadMovements();requests[1].resolve({owner_id:'alice',movements:[{code:'2317',triggered:true,date:state.date}]});await all;assert.match(ctx.movementOverview(),/成交值前十/);
});
test('watchlist additions and removals invalidate the scope even for ranking overlaps',()=>{
 const {ctx,state}=fixture();const before=ctx.movementContext().key;state.companies.push({code:'2317',name:'鴻海'});assert.notEqual(ctx.movementContext().key,before);
 state.companies=state.companies.filter(c=>c.code!=='2327');assert.ok(!ctx.movementContext().codes.includes('2327'));
});
test('rapid company changes cannot repaint current selection with old results',async()=>{
 const {ctx,state,requests,renders}=fixture();state.selected='2330';const first=ctx.loadMovements();state.selected='2327';const second=ctx.loadMovements();const count=renders.length;
 requests[0].resolve({owner_id:'alice',movements:[{code:'2330',triggered:true}]});await first;assert.equal(renders.length,count);assert.doesNotMatch(ctx.movementOverview(),/data-movement="2330"/);
 requests[1].resolve({owner_id:'alice',movements:[{code:'2327',triggered:false,reason:'行情不足'}]});await second;assert.match(ctx.movementOverview(),/目前選擇：2327 國巨/);assert.match(ctx.movementOverview(),/行情不足/);
});
