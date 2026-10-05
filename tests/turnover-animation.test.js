import test from 'node:test';
import assert from 'node:assert/strict';
import {turnoverFrames} from '../src/turnover-animation.js';
const catalog={groups:[{id:'a',industry:'半導體',name:'設計',codes:['1111']},{id:'b',industry:'PCB',name:'基板',codes:['2222']}]};
const history=Array.from({length:15},(_,i)=>({date:'2026-09-'+String(i+1).padStart(2,'0'),previousDate:i?'2026-09-'+String(i).padStart(2,'0'):null,turnover:[['1111',10+i],['2222',90-i]],total:100}));
test('animation uses latest ten saved trading dates at or before selected date',()=>{const r=turnoverFrames(catalog,history,'2026-09-13');assert.equal(r.frames.length,10);assert.equal(r.frames[0].date,'2026-09-04');assert.equal(r.frames.at(-1).date,'2026-09-13');assert.equal(r.frames[0].flows.find(g=>g.id==='a').change,1);});
test('industry scope limits segments without changing market denominator',()=>{const r=turnoverFrames(catalog,history,'2026-09-15','半導體');assert.equal(r.groups.length,1);assert.equal(r.frames.at(-1).flows[0].share,24);});
test('missing prior date leaves change unknown and missing history creates no points',()=>{const r=turnoverFrames(catalog,[history[2]],'2026-09-15');assert.equal(r.frames[0].flows[0].change,null);assert.equal(turnoverFrames(catalog,[],'2026-09-15').frames.length,0);});
