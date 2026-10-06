import test from 'node:test';
import assert from 'node:assert/strict';
import {tradingCalendarCells} from '../src/trading-date-calendar.js';
test('calendar only enables dates with ranking data including missing weekdays and month boundaries',()=>{
 const cells=tradingCalendarCells(2026,9,['2026-09-30','2026-10-01','2026-10-05']);
 assert.equal(cells.length,42);assert.equal(cells.filter(c=>c.enabled).length,3);
 assert.equal(cells.find(c=>c.key==='2026-09-30').enabled,true);
 assert.equal(cells.find(c=>c.key==='2026-10-02').enabled,false);
 assert.equal(cells.find(c=>c.key==='2026-10-03').enabled,false);
 assert.ok(tradingCalendarCells(2026,9,[]).every(c=>!c.enabled));
});
