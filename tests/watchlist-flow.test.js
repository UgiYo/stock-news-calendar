import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../src/main.js',import.meta.url),'utf8');
function setup(overrides={}){
 const state={user:{id:'user'},query:'2330',companies:[],matches:[],preview:[],previewCompany:null};
 const context=vm.createContext({state,render(){},api:async()=>({companies:[{code:'2330',name:'台積電'}]}),collect:async()=>{},...overrides});
 vm.runInContext(source.slice(source.indexOf('async function search(){'),source.indexOf('async function collect(code){')),context);
 return context;
}
test('exact company search offers tracking without requesting news preview',async()=>{
 const paths=[];const c=setup({api:async path=>{paths.push(path);return {companies:[{code:'2330',name:'台積電'}]};}});
 await c.search();assert.deepEqual(paths,['/companies?q=2330']);assert.equal(c.state.matches.length,1);
});
test('saved tracking remains successful when news collection fails',async()=>{
 const c=setup({collect:async()=>{throw Error('collector offline');}});c.state.matches=[{code:'2330',name:'台積電'}];
 await c.add('2330');assert.equal(c.state.companies[0].name,'台積電');assert.match(c.state.message,/追蹤清單已保存/);assert.match(c.state.message,/collector offline/);
});
test('failed save does not add company or collect news',async()=>{
 let collected=false;const c=setup({api:async()=>{throw Error('save failed');},collect:async()=>{collected=true;}});
 await assert.rejects(c.add('2330'),/save failed/);assert.equal(c.state.companies.length,0);assert.equal(collected,false);
});
test('batch collection continues after one source failure and reports affected code',async()=>{
 const calls=[],state={user:{id:'user'},companies:[{code:'6515'},{code:'2330'}],message:''};const context=vm.createContext({state,render(){},load:async()=>{},syncEnabled:()=>false,jobRequest:async(path,body)=>{calls.push(body.code);if(body.code==='6515')throw Error('source unavailable');}});
 const start=source.indexOf('async function collect(code){'),end=source.indexOf('\n}',start)+2;vm.runInContext(source.slice(start,end),context);
 await assert.rejects(context.collect(),/6515：source unavailable/);assert.deepEqual(calls,['6515','2330']);assert.match(state.message,/1 檔新聞已更新/);
});
