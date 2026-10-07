import {test} from 'node:test';
import assert from 'node:assert/strict';
import {trackedPublicReports} from '../src/public-broker-reports.js';
test('public originals follow watchlist and selected stock independently of calendar month',()=>{
 assert.equal(trackedPublicReports([{code:'2327',name:'國巨*'}]).length,2);
 assert.equal(trackedPublicReports([{code:'2330'}]).length,0);
 assert.equal(trackedPublicReports([{code:'2327'},{code:'2330'}],'2330').length,0);
 assert.deepEqual(trackedPublicReports([{code:'2327'}]).map(r=>r.date),['2023-04-21','2023-03-15']);
 assert.ok(trackedPublicReports([{code:'2327'}]).every(r=>r.target===null));
});
test('newly tracked stock immediately matches public catalog and duplicate sources are suppressed',()=>{
 const rows=[{id:'one',code:'2327',date:'2026-10-01',url:'https://broker.example/r.pdf'},{id:'one',code:'2327',date:'2026-10-01',url:'https://broker.example/r.pdf'}];
 assert.equal(trackedPublicReports([], '',rows).length,0);
 assert.equal(trackedPublicReports([{code:'2327'}],'',rows).length,1);
});