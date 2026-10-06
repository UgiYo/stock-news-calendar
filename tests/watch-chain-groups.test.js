import test from 'node:test';
import assert from 'node:assert/strict';
import {groupWatchChainSignals,renderWatchChainGroups} from '../src/ranking.js';
import {trendBadge} from '../src/turnover-animation.js';
const link=(id,hot=false,high=false)=>({id,industry:'產業',name:id,amount:100,hot,high});
test('coarse chains merge fine categories and deduplicate tracked stocks within each industry',()=>{
 const groups=groupWatchChainSignals([{code:'1',links:[link('a'),link('b',true)]},{code:'2',links:[link('a')]},{code:'3',links:[]}]);
 assert.deepEqual(groups.map(g=>g.id),['產業',null]);
 assert.deepEqual(groups[0].stocks.map(s=>s.code),['1','2']);assert.equal(groups[0].stocks[0].links.length,2);
 assert.equal(groups[1].stocks[0].code,'3');
});
test('high correlation industries precede warming industries and memberships remain accurate',()=>{
 const groups=groupWatchChainSignals([{code:'1',links:[{...link('hot',true),industry:'PCB'}]},{code:'2',links:[{...link('high',true,true),industry:'半導體'},link('other')]}]);
 assert.equal(groups[0].id,'半導體');assert.deepEqual(groupWatchChainSignals([]),[]);
});
test('coarse groups are collapsed by default and show fine categories only inside stock rows',()=>{
 const html=renderWatchChainGroups([{code:'1',name:'股票',links:[link('fine',true)]}],s=>s,n=>n);
 assert.doesNotMatch(html,/<details[^>]* open/);assert.match(html,/<strong>產業<\/strong>/);assert.match(html,/watch-chain-links/);assert.equal((html.match(/data-stock="1"/g)||[]).length,1);
});
test('trend badges distinguish warming, strengthening and cooling with text',()=>{
 assert.match(trendBadge('持續升溫'),/trend-warming/);
 assert.match(trendBadge('近期轉強'),/trend-strengthening/);
 assert.match(trendBadge('近期轉弱'),/trend-cooling/);
});
