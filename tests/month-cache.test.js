import test from 'node:test';
import assert from 'node:assert/strict';
import {createMonthCache} from '../src/month-cache.js';
test('month cache retains empty results, expires and separates users',()=>{let time=0;const cache=createMonthCache({ttl:100,now:()=>time});cache.set('alice:10',[]);assert.deepEqual(cache.get('alice:10'),[]);assert.equal(cache.get('bob:10'),undefined);time=100;assert.equal(cache.get('alice:10'),undefined);});
test('month cache evicts oldest unused month and clears after mutations',()=>{const cache=createMonthCache({limit:2});cache.set('a',[1]);cache.set('b',[2]);cache.get('a');cache.set('c',[3]);assert.equal(cache.get('b'),undefined);assert.deepEqual(cache.get('a'),[1]);cache.clear();assert.equal(cache.get('a'),undefined);});
