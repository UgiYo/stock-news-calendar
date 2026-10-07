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
 const report={id:'one',code:'2327',date:'2026-10-01',url:'https://www.sinotrade.com.tw/UploadFiles/r.pdf',broker:'永豐投顧',rating:'中立',type:'公開原始研究報告',verifiedAt:'2026-10-07'};const rows=[report,{...report}];
 assert.equal(trackedPublicReports([], '',rows).length,0);
 assert.equal(trackedPublicReports([{code:'2327'}],'',rows).length,1);
});
test('exclude newspaper sources, unattributed data and reports without explicit rating or target',()=>{
 const base={id:'one',code:'2327',date:'2026-10-01',url:'https://www.sinotrade.com.tw/UploadFiles/r.pdf',broker:'永豐投顧',rating:'中立',type:'公開原始研究報告',verifiedAt:'2026-10-07'};
 const count=changes=>trackedPublicReports([{code:'2327'}],'',[{...base,...changes}]).length;
 assert.equal(count({rating:'未明示',target:null}),0);
 assert.equal(count({rating:'待確認',target:0}),0);
 assert.equal(count({rating:'',target:NaN}),0);
 assert.equal(count({url:'https://news.cnyes.com/news/id/123',target:500}),0);
 assert.equal(count({type:'新聞轉述',target:500}),0);
 assert.equal(count({broker:'未具名外資／券商',target:500}),0);
 assert.equal(count({verifiedAt:''}),0);
 assert.equal(count({rating:'',target:500}),1);
 assert.equal(count({target:null}),1);
});
