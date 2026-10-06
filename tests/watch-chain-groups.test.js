import test from 'node:test';
import assert from 'node:assert/strict';
import {groupWatchChainSignals} from '../src/ranking.js';
import {trendBadge} from '../src/turnover-animation.js';
const link=(id,hot=false,high=false)=>({id,industry:'產業',name:id,amount:100,hot,high});
test('tracked stocks share chain groups, retain overlapping memberships and unmatched stocks',()=>{
 const groups=groupWatchChainSignals([{code:'1',links:[link('a'),link('b',true)]},{code:'2',links:[link('a')]},{code:'3',links:[]}]);
 assert.deepEqual(groups.map(g=>g.id),['b','a',null]);
 assert.deepEqual(groups[1].stocks.map(s=>s.code),['1','2']);
 assert.equal(groups[2].stocks[0].code,'3');
});
test('high correlation groups precede hot groups and individual signals are preserved',()=>{
 const groups=groupWatchChainSignals([{code:'1',links:[link('hot',true)]},{code:'2',links:[link('high',true,true)]},{code:'3',links:[link('high')]}]);
 assert.equal(groups[0].id,'high');assert.equal(groups[0].stocks[1].link.high,false);
 assert.deepEqual(groupWatchChainSignals([]),[]);
});
test('trend badges distinguish warming, strengthening and cooling with text',()=>{
 assert.match(trendBadge('持續升溫'),/trend-warming/);
 assert.match(trendBadge('近期轉強'),/trend-strengthening/);
 assert.match(trendBadge('近期轉弱'),/trend-cooling/);
});
