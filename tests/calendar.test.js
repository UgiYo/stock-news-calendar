import {test} from 'node:test';import assert from 'node:assert/strict';import {dayKey,monthCells,summarize,safeURL} from '../src/utils.js';
test('publication time crosses into next Taiwan day',()=>assert.equal(dayKey('2026-09-30T18:00:00Z'),'2026-10-01'));
test('calendar covers leap-day and adjacent month',()=>{const c=monthCells(2024,1);assert.equal(c.length,42);assert.ok(c.some(x=>x.key==='2024-02-29'&&x.current));assert.equal(c[0].key,'2024-01-28');});
test('source summary is derived only from provided headlines',()=>{assert.ok(summarize([{title:'公司公布營收',source:'A'}]).includes('公司公布營收'));assert.equal(safeURL('javascript:alert(1)'),'#');});
