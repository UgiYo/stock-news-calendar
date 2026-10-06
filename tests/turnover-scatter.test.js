import test from 'node:test';
import assert from 'node:assert/strict';
import {scatterScale,scatterPoint,interpolateScatter} from '../src/turnover-scatter.js';
const flow=(id,share,change,amount)=>({id,share,change,amount});
test('scatter uses a fixed full-period scale, including cooling and excluding missing comparisons',()=>{
 const frames=[{flows:[flow('a',3,1,2e8),flow('b',99,null,1e10)]},{flows:[flow('a',6,-2,4e8)]}];
 const scale=scatterScale(frames,['a','b']);assert.equal(scale.maxShare,6*1.12);assert.equal(scale.maxChange,2.4);assert.equal(scale.maxAmount,4e8);
 const early=scatterPoint(frames[0].flows[0],scale),late=scatterPoint(frames[1].flows[0],scale);assert.ok(late.x>early.x);assert.ok(early.y<176);assert.ok(late.y>176);assert.ok(late.r>early.r);
 for(const p of [early,late]){assert.ok(p.x>=66&&p.x<=536);assert.ok(p.y>=40&&p.y<=312);}
});
test('empty and flat scatter periods retain valid coordinates and zero line',()=>{
 const scale=scatterScale([],[]),point=scatterPoint(flow('a',0,0,0),scale);assert.deepEqual(point,{x:66,y:176,r:5});assert.ok(Object.values(point).every(Number.isFinite));
});

test('continuous transitions interpolate position, size and heat, and can resume from the displayed point',()=>{
 const a={x:0,y:10,r:5,heat:-1},b={x:100,y:30,r:15,heat:1};
 const mid=interpolateScatter(a,b,.5);assert.deepEqual(mid,{x:50,y:20,r:10,heat:0});
 assert.deepEqual(interpolateScatter(mid,b,0),mid);
 assert.deepEqual(interpolateScatter(mid,b,1),b);
 assert.deepEqual(interpolateScatter(a,b,2),b);
 assert.equal(interpolateScatter(a,b,.51).x-mid.x,1);
});
